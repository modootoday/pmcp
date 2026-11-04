import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { LeaseSettings } from "./config.js";
import type { LeaseLane } from "./files.js";
import {
  applyIo,
  cgroupHost,
  ioDelegated,
  scopeCgroup,
  type CgroupHost,
} from "./iocontrol.js";

// A leased job runs in its own user scope when that buys something: MemoryMax with swap off,
// so a runaway job is killed alone, or an io.weight for its lane. Otherwise it runs as is.

export interface Scoped {
  readonly argv: readonly string[];
  // Called once the job runs: the scope exists then, so its io settings can be written.
  readonly started?: () => Promise<void>;
  // The job without the scope, for a systemd-run that still cannot reach the user manager.
  readonly unscoped?: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

// Why a user scope cannot be made for this environment, or null when it can.
export interface UserManager {
  readonly unreachable: (env: Env) => string | null;
}

// systemd-run --user needs the user manager's socket; without it it fails the whole command.
export const BUS_FAILURE = /Failed to connect to (?:the )?bus/u;

let installed: boolean | undefined;
const probed = new Map<string, string | null>();

function probeScope(env: Env): string | null {
  const run = spawnSync("systemd-run", ["--user", "--scope", "-q", "true"], {
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 10_000,
  });
  if (run.status === 0) return null;
  const line = (run.stderr ?? "").trim().split("\n")[0];
  return line || `systemd-run --user exited ${run.status ?? "on a signal"}`;
}

function systemdRun(): boolean {
  installed ??=
    spawnSync("systemd-run", ["--user", "--version"], { stdio: "ignore" })
      .status === 0;
  return installed;
}

export function userManager(
  exists: (path: string) => boolean = existsSync,
  probe: (env: Env) => string | null = probeScope,
  platform: string = process.platform,
  present: () => boolean = systemdRun,
): UserManager {
  return {
    unreachable(env) {
      if (platform !== "linux") return "not Linux";
      if (!present()) return "systemd-run is not installed";
      const runtime = env["XDG_RUNTIME_DIR"];
      if (!runtime) return "XDG_RUNTIME_DIR is not set";
      const socket =
        exists(join(runtime, "systemd", "private")) ||
        exists(join(runtime, "bus")) ||
        Boolean(env["DBUS_SESSION_BUS_ADDRESS"]);
      if (!socket) return `no user manager socket in ${runtime}`;
      if (!probed.has(runtime)) probed.set(runtime, probe(env));
      return probed.get(runtime) ?? null;
    },
  };
}

function lost(memoryMax: string | undefined, io: boolean): string {
  const parts = [
    ...(memoryMax === undefined ? [] : [`MemoryMax=${memoryMax}`]),
    ...(io ? ["io.weight"] : []),
  ];
  return parts.join(" and ");
}

export function wantsIo(
  settings: LeaseSettings,
  lane: LeaseLane | null,
  host: CgroupHost,
): boolean {
  if (lane === null || settings.io.enabled === false) return false;
  return ioDelegated(host);
}

async function weigh(
  unit: string,
  settings: LeaseSettings,
  lane: LeaseLane,
  host: CgroupHost,
  say: (line: string) => void,
  onCgroup: (dir: string) => void,
): Promise<void> {
  for (let tries = 0; tries < 30; tries += 1) {
    const scope = scopeCgroup(unit);
    if (scope !== null) {
      onCgroup(join(host.root, scope));
      const set = applyIo(
        host,
        scope,
        settings.io.weights[lane],
        settings.io.max[lane],
      );
      if (!set && settings.io.enabled === true)
        say(`io control did not reach ${scope}; running without io.weight`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function scoped(
  argv: readonly string[],
  settings: LeaseSettings,
  lane: LeaseLane | null,
  memoryMax: string | undefined,
  say: (line: string) => void,
  onCgroup: (dir: string) => void = () => {},
  host: CgroupHost = cgroupHost(),
  manager: UserManager = userManager(),
  env: Env = process.env,
): Scoped {
  const io = wantsIo(settings, lane, host);
  if (memoryMax === undefined && !io) return { argv };
  const reason = manager.unreachable(env);
  if (reason !== null) {
    say(
      `no systemd user scope (${reason}); running without ${lost(memoryMax, io)}`,
    );
    return { argv };
  }
  const unit = `pmcp-heavy-${process.pid}-${Date.now()}`;
  const limits =
    memoryMax === undefined
      ? []
      : ["-p", `MemoryMax=${memoryMax}`, "-p", "MemorySwapMax=0"];
  return {
    argv: [
      "systemd-run",
      "--user",
      "--scope",
      "-q",
      `--unit=${unit}`,
      ...limits,
      "--",
      ...argv,
    ],
    unscoped: argv,
    ...(io && lane !== null
      ? { started: () => weigh(unit, settings, lane, host, say, onCgroup) }
      : {}),
  };
}
