import { availableParallelism } from "node:os";

import { ConfigError, findConfig, readConfig } from "../config.js";
import { child, Reader, table } from "../git/config/reader.js";
import { expandPath } from "../sessions/paths.js";
import { LANES, type LeaseLane } from "./files.js";
import { DEFAULT_HEAVY, HEAVY_PRESET } from "./heavy-preset.js";
import { DEFAULT_JOB_LOG_BYTES } from "./job-log.js";

// [host.lease]: a host-wide budget for heavy commands. It trades throughput for stability: a
// queued job waits instead of overflowing memory or IO beside the others.

export type GuardMode = "observe" | "warn" | "deny" | "off";
export type IoWindow = "avg10" | "avg60" | "avg300";

export interface LeaseProfile {
  readonly maxWait: number;
  readonly loadGrace: number;
  readonly memoryMax?: string;
}

export interface LeaseCommand {
  readonly argv: readonly string[];
  readonly lane?: LeaseLane;
  readonly weight?: number;
}

export interface IoSettings {
  // "auto": where the io controller reaches the user's scopes; false never; true also says
  // when it could not.
  readonly enabled: "auto" | boolean;
  readonly weights: Readonly<Record<LeaseLane, number>>;
  // io.max lines per lane, such as "259:0 wbps=50000000"; the device is the host's to name.
  readonly max: Readonly<Partial<Record<LeaseLane, string>>>;
}

export interface LeaseSettings {
  readonly enabled: boolean;
  readonly dir: string;
  readonly markerEnv: string;
  readonly legacyMarkerEnv?: string;
  readonly legacySkipEnv?: string;
  // Skip reasons honoured even for a bulk job: callers that must never wait on the lease.
  readonly skipAlways: readonly string[];
  // Further skip reasons honoured for an ordinary command; nested and operator are built in.
  readonly skipReasons: readonly string[];
  readonly maxLoad: number;
  readonly maxIo: number;
  // Which IO pressure average the host check reads; a longer one does not stall on spikes.
  readonly ioWindow: IoWindow;
  // Past load_grace a job still waits while load or io is at this many times its limit.
  readonly hardFactor: number;
  readonly holdWarn: number;
  readonly holdMax?: number;
  readonly heartbeat: number;
  readonly poll: number;
  // Running weight never exceeds the budget; budget 1 is one job at a time.
  readonly budget: number;
  readonly slots: Readonly<Record<LeaseLane, number>>;
  readonly weights: Readonly<Record<LeaseLane, number>>;
  // Lane and weight by argv prefix, for a command run without --lane or --weight.
  readonly commands: readonly LeaseCommand[];
  // Commands so short they take no slot and no budget (weight 0); only the hard ceiling holds them.
  readonly tiny: readonly (readonly string[])[];
  // How many interactive or bulk jobs one session may have queued per lane; 0 is no cap.
  readonly perSession: number;
  readonly profiles: Readonly<Record<string, LeaseProfile>>;
  readonly heavy: readonly (readonly string[])[];
  readonly guard: GuardMode;
  readonly io: IoSettings;
  // usage.jsonl is rotated to usage.jsonl.1 past this many bytes.
  readonly usageCap: number;
  // A job's kept output is rotated past this many bytes; 0 keeps none for a blocking run.
  readonly jobLogBytes?: number;
  // After a leased job ends, how long its leftover IO may hold the queue back.
  readonly settleWindow: number;
}

export const DISABLE_ENV = "PMCP_HEAVY_DISABLE";
export const NOW_ENV = "PMCP_HEAVY_NOW";
export const BUSY_EXIT = 75;

const KEYS = [
  "enabled",
  "dir",
  "marker_env",
  "legacy_marker_env",
  "legacy_skip_env",
  "max_load",
  "max_io",
  "io_window",
  "hard_factor",
  "max_wait",
  "load_grace",
  "hold_warn",
  "hold_max",
  "heartbeat",
  "poll",
  "memory_max",
  "budget",
  "lanes",
  "weights",
  "commands",
  "tiny",
  "per_session",
  "profiles",
  "heavy",
  "guard",
  "io",
  "usage_cap",
  "job_log_bytes",
  "settle_window",
  "skip_always",
  "skip_reasons",
];
const SIZE = /^[1-9]\d*[KMGT]$/u;
type Raw = Readonly<Record<string, unknown>>;

function fail(path: string, message: string): never {
  throw new ConfigError(path, message);
}

function memory(path: string, where: string, value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SIZE.test(value))
    fail(path, `[${where}] memory_max must be a size such as "6G" or "512M"`);
  return value;
}

// Zero allowed: load_grace 0 is no grace, per_session 0 no cap, a lane of 0 slots closed.
function whole(
  path: string,
  where: string,
  key: string,
  value: unknown,
  fallback: number,
) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 0)
    fail(path, `[${where}] ${key} must be a whole number`);
  return value as number;
}

function argvList(path: string, value: unknown): string[][] {
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
    fail(
      path,
      '[host.lease] heavy must be a list of argv prefixes, such as [["npm", "install"]]',
    );
  return value as string[][];
}

function perLane(
  path: string,
  where: string,
  raw: Raw | undefined,
  defaults: Record<LeaseLane, number>,
  least: number,
): Record<LeaseLane, number> {
  const found = { ...defaults };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!LANES.includes(key as LeaseLane))
      fail(path, `unknown key [${where}] ${key}`);
    const number = whole(path, where, key, value, 0);
    if (number < least)
      fail(path, `[${where}] ${key} must be at least ${least}`);
    found[key as LeaseLane] = number;
  }
  return found;
}

function commands(path: string, value: unknown): LeaseCommand[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    fail(path, "[host.lease] commands must be a list of tables");
  return value.map((item, at) => {
    const where = `host.lease.commands[${at}]`;
    const entry = table(path, where, item) ?? {};
    new Reader(path, where, entry, ["argv", "lane", "weight"]);
    const [argv] = argvList(path, [entry["argv"]]);
    const lane = entry["lane"];
    if (lane !== undefined && !LANES.includes(lane as LeaseLane))
      fail(path, `[${where}] lane must be ${LANES.join(" | ")}`);
    const weight = entry["weight"];
    if (
      weight !== undefined &&
      !(Number.isInteger(weight) && (weight as number) >= 0)
    )
      fail(path, `[${where}] weight must be a whole number`);
    return {
      argv: argv!,
      ...(lane ? { lane: lane as LeaseLane } : {}),
      ...(weight !== undefined ? { weight: weight as number } : {}),
    };
  });
}

function profile(path: string, name: string, raw: Raw, base: LeaseProfile) {
  const where = `host.lease.profiles.${name}`;
  const read = new Reader(path, where, raw, [
    "max_wait",
    "load_grace",
    "memory_max",
  ]);
  const memoryMax = memory(path, where, raw["memory_max"]) ?? base.memoryMax;
  return {
    maxWait: read.int("max_wait", base.maxWait),
    loadGrace: whole(
      path,
      where,
      "load_grace",
      raw["load_grace"],
      base.loadGrace,
    ),
    ...(memoryMax ? { memoryMax } : {}),
  };
}

function profiles(path: string, raw: Raw | undefined, base: LeaseProfile) {
  const named: Record<string, LeaseProfile> = {
    default: base,
    gate: { ...base, maxWait: 2700, loadGrace: 600 },
    // Commit-hook work is short: a brief host check, then it runs unless the host is severe.
    hook: { ...base, maxWait: 900, loadGrace: 30 },
  };
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(name))
      fail(path, `[host.lease.profiles] bad name ${name}`);
    const inner = table(path, `host.lease.profiles.${name}`, value) ?? {};
    named[name] = profile(path, name, inner, named[name] ?? base);
  }
  return named;
}

function ioSettings(path: string, raw: Raw | undefined): IoSettings {
  const table = raw ?? {};
  new Reader(path, "host.lease.io", table, ["enabled", "weights", "max"]);
  const enabled = table["enabled"] ?? "auto";
  if (enabled !== "auto" && typeof enabled !== "boolean")
    fail(path, '[host.lease.io] enabled must be "auto", true or false');
  const weights = perLane(
    path,
    "host.lease.io.weights",
    child(path, table, "host.lease.io", "weights"),
    { gate: 500, hook: 300, interactive: 100, bulk: 25 },
    1,
  );
  if (Object.values(weights).some((weight) => weight > 10000))
    fail(path, "[host.lease.io.weights] a weight is at most 10000");
  const max: Partial<Record<LeaseLane, string>> = {};
  for (const [lane, line] of Object.entries(
    child(path, table, "host.lease.io", "max") ?? {},
  )) {
    if (!LANES.includes(lane as LeaseLane))
      fail(path, `unknown key [host.lease.io.max] ${lane}`);
    if (
      typeof line !== "string" ||
      !/^\d+:\d+( [a-z]+=(\d+|max))+$/u.test(line)
    )
      fail(
        path,
        `[host.lease.io.max] ${lane} must be an io.max line such as "8:0 wbps=50000000"`,
      );
    max[lane as LeaseLane] = line;
  }
  return { enabled: enabled as IoSettings["enabled"], weights, max };
}

const REASON = /^[a-z][a-z0-9_.:-]{0,63}$/u;

function reasons(path: string, key: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && REASON.test(item))
  )
    fail(
      path,
      `[host.lease] ${key} must be a list of skip reasons: lower-case words such as "git-hook"`,
    );
  return value as string[];
}

// "default" names the preset, alone or among argv prefixes; a declared [host.lease] without
// heavy gets the preset, so the guard measures in observe until the project says otherwise.
function heavyList(path: string, value: unknown, declared: boolean) {
  if (value === undefined) return declared ? [...DEFAULT_HEAVY] : [];
  const items = value === HEAVY_PRESET ? [value] : value;
  if (!Array.isArray(items))
    fail(
      path,
      `[host.lease] heavy must be "${HEAVY_PRESET}" or a list of argv prefixes`,
    );
  const preset = items.includes(HEAVY_PRESET);
  const own = argvList(
    path,
    items.filter((item) => item !== HEAVY_PRESET),
  );
  return [...(preset ? DEFAULT_HEAVY : []), ...own];
}

function hardFactor(path: string, value: unknown): number {
  if (value === undefined) return 2;
  if (typeof value !== "number" || !(value >= 1))
    fail(path, "[host.lease] hard_factor must be a number of at least 1");
  return value;
}

// Without a table every default applies: the lease is on for every host that runs pmcp heavy.
export function readLeaseSettings(
  path: string,
  dir: string,
  host: unknown,
): LeaseSettings {
  const root = table(path, "host", host) ?? {};
  const declared = child(path, root, "host", "lease");
  const raw = declared ?? {};
  const read = new Reader(path, "host.lease", raw, KEYS);
  const memoryMax = memory(path, "host.lease", raw["memory_max"]);
  const base: LeaseProfile = {
    maxWait: read.int("max_wait", 3600),
    loadGrace: whole(path, "host.lease", "load_grace", raw["load_grace"], 900),
    ...(memoryMax ? { memoryMax } : {}),
  };
  const holdMax = read.positive("hold_max");
  const legacyMarkerEnv = read.envName("legacy_marker_env");
  const legacySkipEnv = read.envName("legacy_skip_env");
  const lanes = child(path, raw, "host.lease", "lanes");
  const weights = child(path, raw, "host.lease", "weights");
  return {
    enabled: read.bool("enabled", true),
    dir: expandPath(dir, read.string("dir") ?? "~/.cache/pmcp/host"),
    markerEnv: read.envName("marker_env") ?? "PMCP_HEAVY_LEASE",
    ...(legacyMarkerEnv ? { legacyMarkerEnv } : {}),
    ...(legacySkipEnv ? { legacySkipEnv } : {}),
    skipAlways: reasons(path, "skip_always", raw["skip_always"]),
    skipReasons: reasons(path, "skip_reasons", raw["skip_reasons"]),
    maxLoad: read.positive("max_load") ?? availableParallelism(),
    maxIo: read.positive("max_io") ?? 8,
    ioWindow: read.oneOf("io_window", ["avg10", "avg60", "avg300"], "avg60"),
    hardFactor: hardFactor(path, raw["hard_factor"]),
    holdWarn: read.int("hold_warn", 1800),
    ...(holdMax ? { holdMax } : {}),
    heartbeat: read.int("heartbeat", 60),
    poll: read.int("poll", 15),
    budget: read.int("budget", 4),
    slots: perLane(
      path,
      "host.lease.lanes",
      lanes,
      { gate: 1, hook: 1, interactive: 2, bulk: 1 },
      0,
    ),
    weights: perLane(
      path,
      "host.lease.weights",
      weights,
      { gate: 1, hook: 1, interactive: 2, bulk: 3 },
      1,
    ),
    commands: commands(path, raw["commands"]),
    tiny: argvList(path, raw["tiny"]),
    perSession: whole(path, "host.lease", "per_session", raw["per_session"], 1),
    profiles: profiles(path, child(path, raw, "host.lease", "profiles"), base),
    heavy: heavyList(path, raw["heavy"], declared !== undefined),
    guard: read.oneOf("guard", ["observe", "warn", "deny", "off"], "observe"),
    io: ioSettings(path, child(path, raw, "host.lease", "io")),
    usageCap: read.int("usage_cap", 5_000_000),
    jobLogBytes: whole(
      path,
      "host.lease",
      "job_log_bytes",
      raw["job_log_bytes"],
      DEFAULT_JOB_LOG_BYTES,
    ),
    settleWindow: whole(
      path,
      "host.lease",
      "settle_window",
      raw["settle_window"],
      60,
    ),
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
