import { TOOLS, type McpServerSpec, type Tool } from "../spec.js";
import { KEYS, ENV_NAME, fail, object, list, mapping } from "./_shared.js";
import { nativeOptions, environmentSources } from "./options.js";
import { readTransport } from "./transport.js";
import { resolvePluginCommand } from "./plugin-binary.js";

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
    const { command, url, auth } = readTransport(path, where, entry);
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
    if (auth === "pmcp" && headerNames.includes("authorization"))
      fail(
        path,
        where,
        "auth = pmcp owns Authorization; use bearer_token_env_var and pmcp mcp login",
      );
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
      ...(auth === "pmcp" ? { auth } : {}),
      ...(typeof command === "string"
        ? { command: resolvePluginCommand(command) }
        : { url: url as string }),
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
