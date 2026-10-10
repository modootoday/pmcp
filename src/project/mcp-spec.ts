import { ConfigError } from "../config.js";
import { TOOLS, type McpServerSpec, type Tool } from "./spec.js";

type Table = Record<string, unknown>;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const KEYS = new Set([
  "command",
  "args",
  "env",
  "env_vars",
  "env_from",
  "cwd",
  "url",
  "headers",
  "header_env",
  "bearer_token_env_var",
  "native",
  "targets",
  "tools",
  "mailbox",
]);

function fail(path: string, where: string, detail: string): never {
  throw new ConfigError(path, `${where} ${detail}`);
}

function object(path: string, where: string, value: unknown): Table {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, where, "must be a table");
  }
  return value as Table;
}

function list(
  path: string,
  where: string,
  value: unknown,
  unique = true,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item !== "")
  ) {
    fail(path, where, "must be a list of nonempty strings");
  }
  if (unique && new Set(value).size !== value.length) {
    fail(path, where, "contains duplicates");
  }
  return value;
}

function mapping(
  path: string,
  where: string,
  value: unknown,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(object(path, where, value))) {
    if (typeof item !== "string") {
      fail(path, where, "values must be strings");
    }
    result[key] = item;
  }
  return result;
}

function nativeOptions(
  path: string,
  where: string,
  value: unknown,
): Partial<Record<Tool, Record<string, number>>> {
  const fields: Record<Tool, readonly string[]> = {
    claude: ["timeout"],
    codex: ["startup_timeout_sec", "tool_timeout_sec"],
    gemini: ["timeout"],
    grok: ["startup_timeout_sec", "tool_timeout_sec"],
    antigravity: [],
  };
  const result: Partial<Record<Tool, Record<string, number>>> = {};
  for (const [tool, raw] of Object.entries(
    object(path, `${where} native`, value),
  )) {
    if (!(TOOLS as readonly string[]).includes(tool)) {
      fail(path, where, `unknown native target ${tool}`);
    }
    const values: Record<string, number> = {};
    for (const [key, item] of Object.entries(
      object(path, `${where} native.${tool}`, raw),
    )) {
      if (
        !fields[tool as Tool].includes(key) ||
        typeof item !== "number" ||
        !Number.isFinite(item) ||
        item <= 0
      ) {
        fail(path, where, `unsupported native option ${tool}.${key}`);
      }
      values[key] = item;
    }
    result[tool as Tool] = values;
  }
  return result;
}

function environmentSources(
  path: string,
  where: string,
  value: unknown,
): Record<string, { file: string; pointer: string }> {
  const result: Record<string, { file: string; pointer: string }> = {};
  for (const [key, raw] of Object.entries(
    object(path, `${where} env_from`, value),
  )) {
    if (!ENV_NAME.test(key) || key === "PROJECT_ROOT") {
      fail(path, where, "invalid environment source name");
    }
    const source = object(path, `${where} env_from.${key}`, raw);
    if (
      Object.keys(source).some((name) => name !== "file" && name !== "pointer")
    ) {
      fail(path, where, "environment sources accept only file and pointer");
    }
    if (
      typeof source["file"] !== "string" ||
      source["file"] === "" ||
      typeof source["pointer"] !== "string" ||
      !source["pointer"].startsWith("/")
    ) {
      fail(path, where, "environment source needs file and a JSON pointer");
    }
    result[key] = { file: source["file"], pointer: source["pointer"] };
  }
  return result;
}

export function readMcp(
  path: string,
  value: unknown,
): Record<string, McpServerSpec> {
  const servers: Record<string, McpServerSpec> = {};
  for (const [alias, raw] of Object.entries(object(path, "[mcp]", value))) {
    const where = `[mcp.${alias}]`;
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(alias)) {
      fail(path, where, "use lowercase, digits and -");
    }
    const entry = object(path, where, raw);
    for (const key of Object.keys(entry)) {
      if (!KEYS.has(key)) {
        fail(path, where, `unknown field ${key}`);
      }
    }
    const command = entry["command"];
    const url = entry["url"];
    if ((command === undefined) === (url === undefined)) {
      fail(path, where, "provide exactly one of command or url");
    }
    for (const [key, item] of [
      ["command", command],
      ["url", url],
      ["cwd", entry["cwd"]],
    ] as const) {
      if (item !== undefined && (typeof item !== "string" || item === "")) {
        fail(path, where, `${key} must be a nonempty string`);
      }
    }
    if (typeof url === "string") {
      let endpoint: URL;
      try {
        endpoint = new URL(url);
      } catch {
        fail(path, where, "url must be an absolute HTTP(S) endpoint");
      }
      if (
        !["https:", "http:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password
      ) {
        fail(path, where, "url must use HTTP(S) without embedded credentials");
      }
      for (const key of [
        "args",
        "env",
        "env_vars",
        "env_from",
        "cwd",
        "mailbox",
      ]) {
        if (entry[key] !== undefined) {
          fail(path, where, `${key} applies only to stdio`);
        }
      }
    } else {
      for (const key of ["headers", "header_env", "bearer_token_env_var"]) {
        if (entry[key] !== undefined) {
          fail(path, where, `${key} applies only to HTTP`);
        }
      }
    }
    const env = mapping(path, `${where} env`, entry["env"]);
    const envVars = list(path, `${where} env_vars`, entry["env_vars"]);
    const envFrom = environmentSources(path, where, entry["env_from"]);
    if (
      Object.keys(envFrom).some(
        (key) => Object.hasOwn(env, key) || envVars.includes(key),
      )
    ) {
      fail(path, where, "environment source conflicts with env or env_vars");
    }
    for (const key of [...Object.keys(env), ...envVars]) {
      if (!ENV_NAME.test(key) || key === "PROJECT_ROOT") {
        fail(path, where, "invalid environment variable name");
      }
    }
    const headers = mapping(path, `${where} headers`, entry["headers"]);
    const headerEnv = mapping(path, `${where} header_env`, entry["header_env"]);
    const bearerTokenEnvVar = entry["bearer_token_env_var"];
    if (
      bearerTokenEnvVar !== undefined &&
      (typeof bearerTokenEnvVar !== "string" ||
        !ENV_NAME.test(bearerTokenEnvVar))
    ) {
      fail(
        path,
        where,
        "bearer_token_env_var must name an environment variable",
      );
    }
    for (const key of [...Object.keys(headers), ...Object.keys(headerEnv)]) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(key)) {
        fail(path, where, "invalid HTTP header name");
      }
    }
    const headerNames = [
      ...Object.keys(headers),
      ...Object.keys(headerEnv),
    ].map((key) => key.toLowerCase());
    if (new Set(headerNames).size !== headerNames.length) {
      fail(path, where, "duplicate HTTP header names");
    }
    if (
      bearerTokenEnvVar !== undefined &&
      headerNames.includes("authorization")
    ) {
      fail(path, where, "bearer_token_env_var conflicts with Authorization");
    }
    for (const item of Object.values(headers)) {
      if (/[\r\n]/u.test(item) || /\$\{/u.test(item)) {
        fail(path, where, "use header_env for environment references");
      }
    }
    for (const item of Object.values(headerEnv)) {
      if (!ENV_NAME.test(item)) {
        fail(path, where, "header_env values must name environment variables");
      }
    }
    const targets = list(path, `${where} targets`, entry["targets"]);
    if (entry["targets"] !== undefined && targets.length === 0) {
      fail(path, where, "targets cannot be empty");
    }
    for (const tool of targets) {
      if (!(TOOLS as readonly string[]).includes(tool)) {
        fail(path, where, `unknown target ${tool}`);
      }
    }
    if (
      entry["mailbox"] !== undefined &&
      typeof entry["mailbox"] !== "boolean"
    ) {
      fail(path, where, "mailbox must be a boolean");
    }
    servers[alias] = {
      ...(typeof command === "string" ? { command } : { url: url as string }),
      args: list(path, `${where} args`, entry["args"], false),
      env,
      ...(envVars.length > 0 ? { envVars } : {}),
      ...(Object.keys(envFrom).length > 0 ? { envFrom } : {}),
      ...(typeof entry["cwd"] === "string" ? { cwd: entry["cwd"] } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(headerEnv).length > 0 ? { headerEnv } : {}),
      ...(typeof bearerTokenEnvVar === "string" ? { bearerTokenEnvVar } : {}),
      ...(entry["native"] !== undefined
        ? { native: nativeOptions(path, where, entry["native"]) }
        : {}),
      ...(targets.length > 0 ? { targets: targets as Tool[] } : {}),
      ...(entry["tools"] !== undefined
        ? { tools: list(path, `${where} tools`, entry["tools"]) }
        : {}),
      ...(entry["mailbox"] === true ? { mailbox: true } : {}),
    };
  }
  return servers;
}
