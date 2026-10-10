import { blockOutput, jsonOutput, MARK, type Output } from "./outputs.js";
import { ProjectError } from "./package-rules.js";
import type { McpServerSpec, ProjectSpec, Tool } from "./spec.js";
import type { Runtime } from "../runtime.js";
import { isAbsolute, relative } from "node:path";

const runtimeByTool: Readonly<Record<Tool, Runtime>> = {
  claude: "claude-code",
  codex: "codex-cli",
  gemini: "gemini-cli",
  grok: "grok-cli",
  antigravity: "antigravity",
};
const ROOT_VAR = "${PROJECT_ROOT}";
export const ANTIGRAVITY_MCP_PLUGIN = ".agents/plugins/pmcp-mcp";
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu;
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

function shellWord(text: string): string {
  const pieces: string[] = [];
  let offset = 0;
  for (const match of text.matchAll(VARIABLE)) {
    const literal = text.slice(offset, match.index);
    if (literal !== "") {
      pieces.push(quote(literal));
    }
    const name = match[1]!;
    if (name === "PROJECT_ROOT") {
      pieces.push('"$d"');
    } else {
      pieces.push(`"\${${name}:?${name} is required}"`);
    }
    offset = match.index + match[0].length;
  }
  const tail = text.slice(offset);
  if (tail !== "") {
    pieces.push(quote(tail));
  }
  if (pieces.length === 0) {
    return "''";
  }
  return pieces.join("");
}

export interface LaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

function forwardedVariables(server: McpServerSpec): string[] {
  const names = new Set(server.envVars ?? []);
  const words = [
    server.command ?? "",
    ...server.args,
    ...Object.values(server.env),
    server.cwd ?? "",
  ];
  for (const word of words) {
    for (const match of word.matchAll(VARIABLE)) {
      if (match[1] !== "PROJECT_ROOT") {
        names.add(match[1]!);
      }
    }
  }
  return [...names].sort();
}

export function launch(spec: McpServerSpec): LaunchSpec {
  if (spec.command === undefined) {
    throw new ProjectError("An HTTP server cannot be launched as stdio");
  }
  const words = [
    spec.command,
    ...spec.args,
    ...Object.values(spec.env),
    spec.cwd ?? "",
  ];
  const variables = forwardedVariables(spec);
  const needsRoot = words.some((word) => word.includes(ROOT_VAR));
  const needsExpansion = words.some(
    (word) => [...word.matchAll(VARIABLE)].length > 0,
  );
  if (!needsExpansion && !spec.cwd && variables.length === 0) {
    return { command: spec.command, args: spec.args, env: spec.env };
  }
  const statements: string[] = [];
  if (needsRoot) {
    statements.push(
      [
        "d=$PWD",
        'while [ ! -f "$d/pmcp.toml" ]',
        "do",
        '  [ "$d" = / ] && exit 1',
        '  d=$(dirname "$d")',
        "done",
      ].join("\n"),
    );
  }
  for (const name of variables) {
    statements.push(`export ${name}="\${${name}:?${name} is required}"`);
  }
  for (const [key, value] of Object.entries(spec.env)) {
    statements.push(`export ${key}=${shellWord(value)}`);
  }
  if (spec.cwd) {
    statements.push(`cd ${shellWord(spec.cwd)} || exit 1`);
  }
  statements.push(
    `exec ${[spec.command, ...spec.args].map(shellWord).join(" ")}`,
  );
  return { command: "sh", args: ["-c", statements.join("\n")], env: {} };
}

function httpEntry(server: McpServerSpec, tool: Tool): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (tool === "gemini") {
    result["httpUrl"] = server.url;
  } else if (tool === "antigravity") {
    result["serverUrl"] = server.url;
  } else {
    result["url"] = server.url;
  }
  if (tool === "claude") {
    result["type"] = "http";
  }
  const headers = { ...server.headers };
  if (
    tool === "antigravity" &&
    (Object.keys(headers).length > 0 ||
      Object.keys(server.headerEnv ?? {}).length > 0 ||
      server.bearerTokenEnvVar !== undefined)
  ) {
    throw new ProjectError(
      "Antigravity HTTP header projection is not qualified; limit this server's targets",
    );
  }
  if (tool === "codex") {
    if (Object.keys(headers).length > 0) {
      result["http_headers"] = headers;
    }
    if (Object.keys(server.headerEnv ?? {}).length > 0) {
      result["env_http_headers"] = { ...server.headerEnv };
    }
    if (server.bearerTokenEnvVar) {
      result["bearer_token_env_var"] = server.bearerTokenEnvVar;
    }
    return result;
  }
  for (const [key, name] of Object.entries(server.headerEnv ?? {})) {
    headers[key] = `\${${name}}`;
  }
  if (server.bearerTokenEnvVar) {
    headers["Authorization"] = `Bearer \${${server.bearerTokenEnvVar}}`;
  }
  if (Object.keys(headers).length > 0) {
    result["headers"] = headers;
  }
  return result;
}

function nativeEntry(
  spec: ProjectSpec,
  alias: string,
  server: McpServerSpec,
  tool: Tool,
): Record<string, unknown> {
  let result: Record<string, unknown>;
  if (server.url !== undefined) {
    result = httpEntry(server, tool);
  } else {
    const env = { ...server.env };
    if (server.mailbox) {
      env["PMCP_MAILBOX_RUNTIME"] = runtimeByTool[tool];
    }
    let started: LaunchSpec;
    if (Object.keys(server.envFrom ?? {}).length > 0) {
      const entry = relative(spec.root, process.argv[1] ?? "");
      const driverEnv: Record<string, string> = {};
      if (server.mailbox) {
        driverEnv["PMCP_MAILBOX_RUNTIME"] = runtimeByTool[tool];
      }
      if (!isAbsolute(entry) && !entry.startsWith("..")) {
        started = launch({
          command: "node",
          args: [`${ROOT_VAR}/${entry}`, "project", "exec-mcp", alias],
          env: driverEnv,
        });
      } else {
        started = launch({
          command: "pmcp",
          args: ["project", "exec-mcp", alias],
          env: driverEnv,
        });
      }
    } else {
      started = launch({ ...server, env });
    }
    result = { command: started.command, args: [...started.args] };
    if (Object.keys(started.env).length > 0) {
      result["env"] = { ...started.env };
    }
    const variables = forwardedVariables(server).filter(
      (key) => !Object.hasOwn(server.envFrom ?? {}, key),
    );
    if (tool === "codex" && variables.length > 0) {
      result["env_vars"] = variables;
    }
  }
  if (server.tools) {
    if (tool === "gemini") {
      result["includeTools"] = [...server.tools];
    }
    if (tool === "codex") {
      result["enabled_tools"] = [...server.tools];
    }
  }
  return { ...result, ...server.native?.[tool] };
}

const tomlValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  if (value !== null && typeof value === "object") {
    const parts = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`,
    );
    return `{ ${parts.join(", ")} }`;
  }
  return JSON.stringify(value);
};

export function serversForTool(
  spec: ProjectSpec,
  tool: Tool,
): Array<[string, McpServerSpec]> {
  return Object.entries(spec.mcp).filter(
    ([, server]) =>
      server.targets === undefined || server.targets.includes(tool),
  );
}

function tomlServers(
  spec: ProjectSpec,
  servers: ReadonlyArray<[string, McpServerSpec]>,
  tool: Tool,
): string {
  const lines = [`# ${MARK} from pmcp.toml [mcp]`];
  for (const [alias, server] of servers) {
    lines.push("", `[mcp_servers.${alias}]`);
    for (const [key, value] of Object.entries(
      nativeEntry(spec, alias, server, tool),
    )) {
      lines.push(`${key} = ${tomlValue(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function mcpOutputs(spec: ProjectSpec): Output[] {
  const outputs: Output[] = [];
  const jsonFiles: Partial<Record<Tool, string>> = {
    claude: ".mcp.json",
    gemini: ".gemini/settings.json",
    antigravity: `${ANTIGRAVITY_MCP_PLUGIN}/mcp_config.json`,
  };
  for (const tool of spec.tools) {
    const servers = serversForTool(spec, tool);
    if (servers.length === 0) {
      continue;
    }
    if (tool === "antigravity") {
      outputs.push({
        kind: "file",
        path: `${ANTIGRAVITY_MCP_PLUGIN}/plugin.json`,
        content: `${JSON.stringify({ name: "pmcp-mcp" }, null, 2)}\n`,
      });
    }
    const file = jsonFiles[tool];
    if (file) {
      for (const [alias, server] of servers) {
        outputs.push(
          jsonOutput(
            file,
            ["mcpServers", alias],
            nativeEntry(spec, alias, server, tool),
          ),
        );
      }
      continue;
    }
    outputs.push(
      blockOutput(`.${tool}/config.toml`, tomlServers(spec, servers, tool)),
    );
  }
  return outputs;
}
