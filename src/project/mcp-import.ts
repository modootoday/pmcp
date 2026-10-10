import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "smol-toml";

import { backupFiles } from "./backup.js";
import { readMcp } from "./mcp-spec.js";
import { ProjectError } from "./package-rules.js";
import { TOOLS, type Tool } from "./spec.js";

type Table = Record<string, unknown>;
export interface McpImportEntry {
  readonly alias: string;
  readonly status: "add" | "unchanged" | "conflict" | "blocked";
  readonly source: string;
  readonly detail?: string;
}
export interface McpImportPlan {
  readonly entries: readonly McpImportEntry[];
  readonly additions: Readonly<Record<string, Table>>;
  readonly original: string;
  readonly config: string;
  readonly sources: readonly { path: string; sha256: string }[];
}

function object(value: unknown): Table {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectError(
      "MCP source must contain object-valued server entries",
    );
  }
  return value as Table;
}

function sourceServers(
  source: string,
  root: string,
): { tool: Tool; path: string; servers: Table; sha256: string } {
  const split = source.indexOf(":");
  const tool = source.slice(0, split);
  if (
    split < 1 ||
    !(TOOLS as readonly string[]).includes(tool) ||
    source.slice(split + 1) === ""
  ) {
    throw new ProjectError(
      "Use --source <claude|codex|gemini|grok|antigravity>:<file>",
    );
  }
  const path = resolve(root, source.slice(split + 1));
  if (statSync(path).size > 2 * 1024 * 1024) {
    throw new ProjectError("MCP source exceeds the 2 MiB limit");
  }
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const text = bytes.toString("utf8").replace(/^\uFEFF/u, "");
  let parsed: Table;
  try {
    if (text.trim() === "") {
      parsed = {};
    } else if (path.endsWith(".toml")) {
      parsed = parse(text);
    } else {
      parsed = object(JSON.parse(text));
    }
  } catch {
    throw new ProjectError(
      `Cannot parse MCP source for ${tool}; source contents are redacted`,
    );
  }
  const servers = parsed["mcpServers"] ?? parsed["mcp_servers"] ?? {};
  return { tool: tool as Tool, path, servers: object(servers), sha256 };
}

function httpCandidate(tool: Tool, entry: Table): Table {
  if (tool === "gemini" && entry["url"] !== undefined) {
    throw new ProjectError(
      "Gemini url entries use SSE; use a Streamable HTTP source",
    );
  }
  const url = entry["httpUrl"] ?? entry["url"] ?? entry["serverUrl"];
  if (typeof url !== "string") {
    throw new ProjectError("MCP source needs command or url");
  }
  const endpoint = new URL(url);
  const loginFlag =
    endpoint.search === "?login" || endpoint.search === "?login=";
  if (
    (endpoint.search && !loginFlag) ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new ProjectError(
      "URLs with query values, fragment or embedded credentials require review before import",
    );
  }
  const result: Table = { url };
  const headers: Record<string, string> = {};
  const headerEnv: Record<string, string> = {};
  const sourceHeaders = object(entry["headers"] ?? entry["http_headers"] ?? {});
  for (const [key, value] of Object.entries(sourceHeaders)) {
    if (typeof value !== "string") {
      throw new ProjectError("HTTP header values must be strings");
    }
    const reference = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u);
    const bearer = value.match(/^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/iu);
    if (reference) {
      headerEnv[key] = reference[1]!;
    } else if (key.toLowerCase() === "authorization" && bearer) {
      result["bearer_token_env_var"] = bearer[1];
    } else if (/authorization|cookie|token|secret|api[-_]?key/iu.test(key)) {
      throw new ProjectError(
        "Credential headers require environment references before import",
      );
    } else {
      headers[key] = value;
    }
  }
  for (const [key, value] of Object.entries(
    object(entry["env_http_headers"] ?? {}),
  )) {
    if (typeof value !== "string") {
      throw new ProjectError("Environment header references must be strings");
    }
    headerEnv[key] = value;
  }
  if (Object.keys(headers).length > 0) {
    result["headers"] = headers;
  }
  if (Object.keys(headerEnv).length > 0) {
    result["header_env"] = headerEnv;
  }
  if (entry["bearer_token_env_var"] !== undefined) {
    result["bearer_token_env_var"] = entry["bearer_token_env_var"];
  }
  return result;
}

function candidate(
  tool: Tool,
  entry: Table,
  file: string,
  alias: string,
): Table {
  const accepted = new Set([
    "type",
    "command",
    "args",
    "env",
    "env_vars",
    "cwd",
    "url",
    "httpUrl",
    "serverUrl",
    "headers",
    "http_headers",
    "env_http_headers",
    "bearer_token_env_var",
    "startup_timeout_sec",
    "tool_timeout_sec",
    "timeout",
    "includeTools",
    "enabled_tools",
  ]);
  for (const key of Object.keys(entry)) {
    if (!accepted.has(key)) {
      throw new ProjectError(
        `Unsupported native field ${key}; review before import`,
      );
    }
  }
  const type = entry["type"];
  if (type !== undefined && type !== "stdio" && type !== "http") {
    throw new ProjectError("Only stdio and Streamable HTTP can be imported");
  }
  let result: Table;
  if (entry["command"] !== undefined) {
    result = { command: entry["command"] };
    if (entry["args"] !== undefined) {
      const args = entry["args"];
      if (
        Array.isArray(args) &&
        args.some(
          (item) =>
            typeof item === "string" &&
            /(?:token|password|secret|api[-_]?key)(?:=|$)/iu.test(item) &&
            !/\$\{/u.test(item),
        )
      ) {
        throw new ProjectError(
          "Credential arguments require environment references before import",
        );
      }
      result["args"] = args;
    }
    const env = object(entry["env"] ?? {});
    const forwarded = entry["env_vars"] ?? [];
    if (
      !Array.isArray(forwarded) ||
      !forwarded.every((item) => typeof item === "string")
    ) {
      throw new ProjectError(
        "Only local environment variable names can be imported",
      );
    }
    const envVars = [...new Set(forwarded)].sort();
    const environment: Table = {};
    const envFrom: Table = {};
    const prefix = file.endsWith(".toml") ? "mcp_servers" : "mcpServers";
    const portable = file.startsWith(`${homedir()}/`)
      ? `~/${file.slice(homedir().length + 1)}`
      : file;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string") {
        throw new ProjectError("MCP environment values must be strings");
      }
      const reference =
        value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u) ??
        value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/u);
      if (reference) {
        const name = reference[1]!;
        if (name === key) {
          envVars.push(key);
        } else {
          environment[key] = `\${${name}}`;
        }
      } else {
        const escapedAlias = alias.replaceAll("~", "~0").replaceAll("/", "~1");
        const escapedKey = key.replaceAll("~", "~0").replaceAll("/", "~1");
        envFrom[key] = {
          file: portable,
          pointer: `/${prefix}/${escapedAlias}/env/${escapedKey}`,
        };
      }
    }
    if (envVars.length > 0) {
      result["env_vars"] = envVars;
    }
    if (Object.keys(environment).length > 0) {
      result["env"] = environment;
    }
    if (Object.keys(envFrom).length > 0) {
      result["env_from"] = envFrom;
    }
    if (entry["cwd"] !== undefined) {
      result["cwd"] = entry["cwd"];
    }
  } else {
    result = httpCandidate(tool, entry);
  }
  const options: Table = {};
  for (const key of ["startup_timeout_sec", "tool_timeout_sec", "timeout"]) {
    if (entry[key] !== undefined) {
      options[key] = entry[key];
    }
  }
  if (Object.keys(options).length > 0) {
    result["native"] = { [tool]: options };
  }
  const filters = entry["includeTools"] ?? entry["enabled_tools"];
  if (filters !== undefined) {
    result["tools"] = filters;
  }
  return result;
}

function equivalent(alias: string, left: Table, right: Table): boolean {
  return (
    JSON.stringify(readMcp("import", { [alias]: left })[alias]) ===
    JSON.stringify(readMcp("import", { [alias]: right })[alias])
  );
}

export function planMcpImport(
  config: string,
  sources: readonly string[],
  names: readonly string[] = [],
): McpImportPlan {
  const original = readFileSync(config, "utf8");
  const root = dirname(resolve(config));
  const existing = object(parse(original)["mcp"] ?? {});
  const additions: Record<string, Table> = {};
  const entries: McpImportEntry[] = [];
  const fingerprints: { path: string; sha256: string }[] = [];
  const wanted = new Set(names);
  for (const source of sources) {
    const read = sourceServers(source, root);
    fingerprints.push({ path: read.path, sha256: read.sha256 });
    for (const [alias, raw] of Object.entries(read.servers)) {
      if (wanted.size > 0 && !wanted.has(alias)) {
        continue;
      }
      try {
        const proposed = candidate(read.tool, object(raw), read.path, alias);
        readMcp(config, { [alias]: proposed });
        const previous = existing[alias] ?? additions[alias];
        if (previous !== undefined) {
          const status = equivalent(alias, object(previous), proposed)
            ? "unchanged"
            : "conflict";
          entries.push({ alias, source: read.path, status });
          continue;
        }
        additions[alias] = proposed;
        entries.push({ alias, source: read.path, status: "add" });
      } catch (error) {
        const detail =
          error instanceof ProjectError
            ? error.message
            : "Unsupported source configuration; values are redacted";
        entries.push({ alias, source: read.path, status: "blocked", detail });
      }
    }
  }
  for (const name of wanted) {
    if (!entries.some((entry) => entry.alias === name)) {
      entries.push({
        alias: name,
        source: "",
        status: "blocked",
        detail: "Requested server was not found",
      });
    }
  }
  return { entries, additions, original, config, sources: fingerprints };
}

export function writeMcpImport(plan: McpImportPlan): string {
  if (
    plan.entries.some(
      (entry) => entry.status === "blocked" || entry.status === "conflict",
    )
  ) {
    throw new ProjectError(
      "Resolve blocked or conflicting MCP entries before importing",
    );
  }
  if (readFileSync(plan.config, "utf8") !== plan.original) {
    throw new ProjectError("pmcp.toml changed after planning; plan again");
  }
  for (const source of plan.sources) {
    const current = createHash("sha256")
      .update(readFileSync(source.path))
      .digest("hex");
    if (current !== source.sha256) {
      throw new ProjectError("MCP source changed after planning; plan again");
    }
  }
  const additions = stringify({ mcp: plan.additions } as Parameters<
    typeof stringify
  >[0]);
  const after = `${plan.original.trimEnd()}\n\n${additions}`;
  parse(after);
  const backup = backupFiles(dirname(resolve(plan.config)), [
    basename(plan.config),
  ]);
  writeFileSync(plan.config, after);
  return backup;
}
