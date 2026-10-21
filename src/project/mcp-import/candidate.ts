import { homedir } from "node:os";
import { ProjectError } from "../package-rules.js";
import { type Tool } from "../spec.js";
import type { Table } from "./types.js";
import { object } from "./_shared.js";
import { httpCandidate } from "./http.js";
export function candidate(
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
