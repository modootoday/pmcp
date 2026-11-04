import { mkdirSync, readFileSync } from "node:fs";

import { skipReason } from "./acquire.js";
import { DISABLE_ENV, type LeaseSettings } from "./config.js";
import {
  describeRecord,
  epoch,
  leaseHeld,
  leasePaths,
  liveWaiters,
  pidAlive,
  readRecord,
} from "./files.js";
import { hostSettled, hostSources, readHost } from "./host.js";
import { outsideLease, type OutsideProcess } from "./procs.js";

// The first lines keep the shell wrapper's shape (lease, host, settled, holder, waiter) for
// readers that parse them; pmcp's additions (hold, outside) come after.

export interface StatusOptions {
  readonly settings: LeaseSettings;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly outside?: (holder: number | null) => readonly OutsideProcess[];
}

function holdLine(settings: LeaseSettings, held: number, pid: number): string {
  const limits = `warn ${settings.holdWarn}s${settings.holdMax ? `, max ${settings.holdMax}s` : ""}`;
  let verdict = "ok";
  if (held >= settings.holdWarn) verdict = "warning: over hold_warn";
  if (settings.holdMax && held >= settings.holdMax)
    verdict = "over-limit: over hold_max";
  return `hold: pid ${pid} ${held}s (${limits}) ${verdict}`;
}

function outsideLines(found: readonly OutsideProcess[]): string[] {
  if (found.length === 0) return ["outside: none"];
  return found.map(
    (item) =>
      `outside: pid ${item.pid} cpu ${item.cpu.toFixed(0)}% io ${item.ioMbps.toFixed(1)}MB/s ${item.command}`,
  );
}

export function leaseStatus(options: StatusOptions): string[] {
  const { settings, env } = options;
  const paths = leasePaths(settings.dir);
  const sources = hostSources(env);
  const reading = readHost(sources);
  const lines: string[] = [];
  if (!settings.enabled) {
    lines.push("lease: disabled ([host.lease] enabled = false)");
    lines.push(
      `host: load1 ${reading.load ?? "n/a"} (max ${settings.maxLoad}), io some avg10 ${reading.io ?? "n/a"} (max ${settings.maxIo})`,
    );
    return lines;
  }
  try {
    mkdirSync(paths.dir, { recursive: true });
  } catch {
    // Status still reads what it can.
  }
  lines.push(`lease: ${paths.lock}`);
  lines.push(
    `host: load1 ${reading.load ?? "n/a"} (max ${settings.maxLoad}), io some avg10 ${reading.io ?? "n/a"} (max ${settings.maxIo})`,
  );
  if (hostSettled(settings, paths, sources)) lines.push("settled: now");
  else {
    let last = "never";
    try {
      last = readFileSync(paths.settled, "utf8").trim() || "never";
    } catch {
      // Never seen settled.
    }
    lines.push(`settled: last seen ${last}`);
  }
  const held = leaseHeld(paths);
  const holder = held ? readRecord(paths.holder) : null;
  lines.push(held ? `holder: ${describeRecord(holder)}` : "holder: none");
  const waiters = liveWaiters(paths);
  for (const waiter of waiters) lines.push(`waiter: ${describeRecord(waiter)}`);
  if (waiters.length === 0) lines.push("waiters: none");
  if (holder !== null && pidAlive(holder.pid))
    lines.push(holdLine(settings, epoch() - holder.since, holder.pid));
  const outside = options.outside ?? ((pid) => outsideLease({ holder: pid }));
  lines.push(...outsideLines(outside(holder?.pid ?? null)));
  const skip = skipReason(settings, env);
  if (skip !== null)
    lines.push(
      `skip: this shell runs without the lease (${DISABLE_ENV}): ${skip}`,
    );
  return lines;
}
