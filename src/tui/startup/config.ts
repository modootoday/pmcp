import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigError, findConfig, readConfig } from "../../config.js";
import { runtimeExecutables } from "../../harness/runtimes/registry.js";
import { locateExecutable } from "../../harness/adapters/process/executable.js";
import {
  productNameOf,
  runtimeIdOf,
  type ProductName,
} from "../../runtime/ids.js";

export interface StartupRequest {
  readonly cwd: string;
  readonly config?: string;
  readonly runtime?: string;
  readonly preset?: string;
  readonly fresh?: boolean;
  readonly uncapped?: boolean;
}

export interface PresetWorker {
  readonly runtime: string;
  readonly memoryMb?: number;
}

export interface StartupSettings {
  readonly projectRoot: string;
  readonly configFile?: string;
  readonly runtime: string;
  readonly preset?: string;
  readonly allowedRuntimes: readonly string[];
  readonly memoryMb: number;
  readonly sessionMemoryMb: number;
  readonly maxActive: number;
  readonly groupFile?: string;
  readonly uncapped?: boolean;
  readonly workers?: readonly PresetWorker[];
}

// The runtime auto picks first when several are installed.
const preference: readonly ProductName[] = [
  "codex-cli",
  "gemini-cli",
  "antigravity",
  "grok-cli",
  "claude-code",
];

// [tui] runtime and --runtime take any spelling (claude, claude-code, agy, ...).
function productSpelling(name: string): string {
  if (name === "auto") return name;
  const id = runtimeIdOf(name);
  return (id && productNameOf(id)) ?? name;
}

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
    "uncapped",
    "presets",
  ]);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) fail(`unknown key ${key}`);
  }
  let presetValues: Record<string, unknown> = {};
  let workers: PresetWorker[] | undefined;
  if (request.preset !== undefined) {
    const presets = values["presets"];
    if (
      !presets ||
      typeof presets !== "object" ||
      Array.isArray(presets) ||
      !Object.hasOwn(presets, request.preset)
    )
      fail(`unknown preset ${request.preset}`);
    const entry = (presets as Record<string, unknown>)[request.preset];
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      fail(`presets.${request.preset} must be a table`);
    presetValues = entry as Record<string, unknown>;
    const rawWorkers = presetValues["workers"];
    if (rawWorkers !== undefined) {
      if (!Array.isArray(rawWorkers))
        return fail(`presets.${request.preset}.workers must be an array`);
      workers = (rawWorkers as unknown[]).map((w, idx) => {
        if (!w || typeof w !== "object" || Array.isArray(w))
          return fail(
            `presets.${request.preset}.workers[${idx}] must be a table`,
          );
        const rec = w as Record<string, unknown>;
        const rawRuntime = rec["runtime"];
        if (typeof rawRuntime !== "string" || !rawRuntime.trim())
          return fail(
            `presets.${request.preset}.workers[${idx}].runtime must be a string`,
          );
        const rt = productSpelling(rawRuntime);
        if (!Object.hasOwn(runtimeExecutables, rt))
          return fail(
            `presets.${request.preset}.workers[${idx}].runtime unsupported`,
          );
        const mem = rec["memory_mb"];
        if (
          mem !== undefined &&
          (typeof mem !== "number" ||
            !Number.isSafeInteger(mem) ||
            mem < 32 ||
            mem > 1536)
        )
          return fail(
            `presets.${request.preset}.workers[${idx}].memory_mb must be 32..1536`,
          );
        return {
          runtime: rt,
          ...(mem !== undefined ? { memoryMb: mem } : {}),
        };
      });
    }
  }
  const effective: Record<string, unknown> = { ...values, ...presetValues };
  const string = (key: string): string | undefined => {
    const value = effective[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim())
      fail(`${key} must be a non-empty string`);
    return value as string;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = effective[key] ?? fallback;
    if (typeof value !== "number" || !Number.isSafeInteger(value))
      fail(`${key} must be an integer`);
    if (Number(value) < min || Number(value) > max)
      fail(`${key} must be between ${min} and ${max}`);
    return Number(value);
  };
  const configured = string("runtime");
  const configuredRuntime =
    configured === undefined ? undefined : productSpelling(configured);
  if (
    configuredRuntime !== undefined &&
    configuredRuntime !== "auto" &&
    !Object.hasOwn(runtimeExecutables, configuredRuntime)
  )
    fail("runtime must be auto or a supported runtime ID");
  const available = preference.filter((runtime) =>
    locateExecutable(runtimeExecutables[runtime]!, request.cwd),
  );
  const requested =
    request.runtime === undefined
      ? undefined
      : productSpelling(request.runtime);
  let runtime = requested ?? configuredRuntime ?? "auto";
  if (runtime === "auto") runtime = available[0] ?? "codex-cli";
  if (!Object.hasOwn(runtimeExecutables, runtime))
    fail("runtime must be a supported runtime ID");
  const memoryMb = integer("memory_mb", 2048, 128, 4096);
  const sessionMemoryMb = integer("session_memory_mb", 768, 32, 1536);
  if (sessionMemoryMb > memoryMb)
    fail("session memory exceeds the group budget");
  const groupFile = string("group_file");
  const configuredUncapped = effective["uncapped"];
  if (
    configuredUncapped !== undefined &&
    typeof configuredUncapped !== "boolean"
  )
    fail("uncapped must be a boolean");
  const uncapped = request.uncapped ?? configuredUncapped ?? false;
  return {
    projectRoot: realpathSync(config?.dir ?? request.cwd),
    ...(config ? { configFile: config.path } : {}),
    runtime,
    ...(request.preset ? { preset: request.preset } : {}),
    allowedRuntimes: [...new Set([...available, runtime])],
    memoryMb,
    sessionMemoryMb,
    maxActive: integer("max_active", 2, 1, 5),
    ...(groupFile
      ? { groupFile: resolve(config?.dir ?? request.cwd, groupFile) }
      : {}),
    ...(uncapped ? { uncapped: true } : {}),
    ...(workers ? { workers } : {}),
  };
}
