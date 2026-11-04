import { availableParallelism } from "node:os";

import { ConfigError, findConfig, readConfig } from "../config.js";
import { child, Reader, table } from "../git/config/reader.js";
import { expandPath } from "../sessions/paths.js";

// [host.lease]: one host-wide lease for heavy commands. It trades throughput for stability: a
// queued job waits instead of overflowing memory or IO beside another one.

export type GuardMode = "observe" | "warn" | "deny" | "off";

export interface LeaseProfile {
  readonly maxWait: number;
  readonly loadGrace: number;
  readonly memoryMax?: string;
}

export interface LeaseSettings {
  readonly enabled: boolean;
  readonly dir: string;
  readonly markerEnv: string;
  readonly legacyMarkerEnv?: string;
  readonly legacySkipEnv?: string;
  readonly maxLoad: number;
  readonly maxIo: number;
  readonly holdWarn: number;
  readonly holdMax?: number;
  readonly heartbeat: number;
  readonly poll: number;
  readonly profiles: Readonly<Record<string, LeaseProfile>>;
  readonly heavy: readonly (readonly string[])[];
  readonly guard: GuardMode;
}

export const DISABLE_ENV = "PMCP_HEAVY_DISABLE";
export const BUSY_EXIT = 75;

const KEYS = [
  "enabled",
  "dir",
  "marker_env",
  "legacy_marker_env",
  "legacy_skip_env",
  "max_load",
  "max_io",
  "max_wait",
  "load_grace",
  "hold_warn",
  "hold_max",
  "heartbeat",
  "poll",
  "memory_max",
  "profiles",
  "heavy",
  "guard",
];
const PROFILE_KEYS = ["max_wait", "load_grace", "memory_max"];
const SIZE = /^[1-9]\d*[KMGT]$/u;

function memory(path: string, where: string, value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SIZE.test(value))
    throw new ConfigError(
      path,
      `[${where}] memory_max must be a size such as "6G" or "512M"`,
    );
  return value;
}

function heavyList(path: string, value: unknown): string[][] {
  if (value === undefined) return [];
  const valid =
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length > 0 &&
        item.every((word) => typeof word === "string" && word !== ""),
    );
  if (!valid)
    throw new ConfigError(
      path,
      '[host.lease] heavy must be a list of argv prefixes, such as [["npm", "install"]]',
    );
  return value as string[][];
}

function profile(
  path: string,
  name: string,
  raw: Readonly<Record<string, unknown>> | undefined,
  base: LeaseProfile,
): LeaseProfile {
  if (raw === undefined) return base;
  const where = `host.lease.profiles.${name}`;
  const read = new Reader(path, where, raw, PROFILE_KEYS);
  const memoryMax = memory(path, where, raw["memory_max"]) ?? base.memoryMax;
  return {
    maxWait: read.int("max_wait", base.maxWait),
    loadGrace: read.int("load_grace", base.loadGrace),
    ...(memoryMax ? { memoryMax } : {}),
  };
}

// Without a table every default applies: the lease is on for every host that runs pmcp heavy.
export function readLeaseSettings(
  path: string,
  dir: string,
  host: unknown,
): LeaseSettings {
  const root = table(path, "host", host) ?? {};
  const raw = child(path, root, "host", "lease") ?? {};
  const read = new Reader(path, "host.lease", raw, KEYS);
  const memoryMax = memory(path, "host.lease", raw["memory_max"]);
  const base: LeaseProfile = {
    maxWait: read.int("max_wait", 3600),
    loadGrace: read.int("load_grace", 900),
    ...(memoryMax ? { memoryMax } : {}),
  };
  const profiles = child(path, raw, "host.lease", "profiles") ?? {};
  const named: Record<string, LeaseProfile> = { default: base };
  named["gate"] = { ...base, maxWait: 2700, loadGrace: 600 };
  for (const [name, value] of Object.entries(profiles)) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(name))
      throw new ConfigError(path, `[host.lease.profiles] bad name ${name}`);
    const inner = table(path, `host.lease.profiles.${name}`, value);
    named[name] = profile(path, name, inner, named[name] ?? base);
  }
  const holdMax = read.positive("hold_max");
  const legacyMarkerEnv = read.envName("legacy_marker_env");
  const legacySkipEnv = read.envName("legacy_skip_env");
  const dirValue = read.string("dir") ?? "~/.cache/pmcp/host";
  return {
    enabled: read.bool("enabled", true),
    dir: expandPath(dir, dirValue),
    markerEnv: read.envName("marker_env") ?? "PMCP_HEAVY_LEASE",
    ...(legacyMarkerEnv ? { legacyMarkerEnv } : {}),
    ...(legacySkipEnv ? { legacySkipEnv } : {}),
    maxLoad: read.positive("max_load") ?? availableParallelism(),
    maxIo: read.positive("max_io") ?? 8,
    holdWarn: read.int("hold_warn", 1800),
    ...(holdMax ? { holdMax } : {}),
    heartbeat: read.int("heartbeat", 60),
    poll: read.int("poll", 15),
    profiles: named,
    heavy: heavyList(path, raw["heavy"]),
    guard: read.oneOf("guard", ["observe", "warn", "deny", "off"], "observe"),
  };
}

// The nearest pmcp.toml's [host.lease], or the defaults where there is none.
export function leaseSettingsFor(
  cwd: string,
  configPath?: string,
): LeaseSettings {
  const path = configPath ?? findConfig(cwd);
  if (path === null) return readLeaseSettings("pmcp.toml", cwd, undefined);
  const config = readConfig(path);
  return readLeaseSettings(config.path, config.dir, config.raw["host"]);
}
