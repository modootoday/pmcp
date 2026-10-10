import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigError, findConfig, readConfig } from "../../config.js";
import { runtimeExecutables } from "../../harness/runtimes/registry.js";
import { locateExecutable } from "../../harness/adapters/process/executable.js";

export interface StartupRequest {
  readonly cwd: string;
  readonly config?: string;
  readonly runtime?: string;
  readonly fresh?: boolean;
}

export interface StartupSettings {
  readonly projectRoot: string;
  readonly configFile?: string;
  readonly runtime: string;
  readonly allowedRuntimes: readonly string[];
  readonly memoryMb: number;
  readonly sessionMemoryMb: number;
  readonly maxActive: number;
  readonly groupFile?: string;
}

const preference = [
  "codex-cli",
  "gemini-cli",
  "antigravity",
  "grok-cli",
  "claude-code",
] as const;

export function startupSettings(request: StartupRequest): StartupSettings {
  const path = request.config
    ? resolve(request.cwd, request.config)
    : findConfig(request.cwd);
  const config = path ? readConfig(path) : undefined;
  const source = config?.raw.tui;
  const fail = (message: string): never => {
    throw new ConfigError(path ?? "pmcp.toml", `[tui] ${message}`);
  };
  if (
    source !== undefined &&
    (source === null || typeof source !== "object" || Array.isArray(source))
  )
    fail("must be a table");
  const values = (source ?? {}) as Record<string, unknown>;
  const allowed = new Set([
    "runtime",
    "memory_mb",
    "session_memory_mb",
    "max_active",
    "group_file",
  ]);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) fail(`unknown key ${key}`);
  }
  const string = (key: string): string | undefined => {
    const value = values[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim())
      fail(`${key} must be a non-empty string`);
    return value as string;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = values[key] ?? fallback;
    if (typeof value !== "number" || !Number.isSafeInteger(value))
      fail(`${key} must be an integer`);
    if (Number(value) < min || Number(value) > max)
      fail(`${key} must be between ${min} and ${max}`);
    return Number(value);
  };
  const configuredRuntime = string("runtime");
  if (
    configuredRuntime !== undefined &&
    configuredRuntime !== "auto" &&
    !Object.hasOwn(runtimeExecutables, configuredRuntime)
  )
    fail("runtime must be auto or a supported runtime ID");
  const available = preference.filter((runtime) =>
    locateExecutable(runtimeExecutables[runtime]!, request.cwd),
  );
  let runtime = request.runtime ?? configuredRuntime ?? "auto";
  if (runtime === "auto") runtime = available[0] ?? "codex-cli";
  if (!Object.hasOwn(runtimeExecutables, runtime))
    fail("runtime must be a supported runtime ID");
  const memoryMb = integer("memory_mb", 2048, 128, 4096);
  const sessionMemoryMb = integer("session_memory_mb", 768, 32, 1536);
  if (sessionMemoryMb > memoryMb)
    fail("session memory exceeds the group budget");
  const groupFile = string("group_file");
  return {
    projectRoot: realpathSync(config?.dir ?? request.cwd),
    ...(config ? { configFile: config.path } : {}),
    runtime,
    allowedRuntimes: [...new Set([...available, runtime])],
    memoryMb,
    sessionMemoryMb,
    maxActive: integer("max_active", 2, 1, 5),
    ...(groupFile
      ? { groupFile: resolve(config?.dir ?? request.cwd, groupFile) }
      : {}),
  };
}
