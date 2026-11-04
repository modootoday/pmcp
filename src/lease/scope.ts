import { spawnSync } from "node:child_process";
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
}

let scopeSeen: boolean | undefined;

function scopeAvailable(): boolean {
  scopeSeen ??=
    process.platform === "linux" &&
    spawnSync("systemd-run", ["--user", "--version"], { stdio: "ignore" })
      .status === 0;
  return scopeSeen;
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
): Scoped {
  const io = wantsIo(settings, lane, host);
  if (memoryMax === undefined && !io) return { argv };
  if (!scopeAvailable()) {
    if (memoryMax !== undefined)
      say(
        `systemd-run --user is unavailable; running without MemoryMax=${memoryMax}`,
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
    ...(io && lane !== null
      ? { started: () => weigh(unit, settings, lane, host, say, onCgroup) }
      : {}),
  };
}
