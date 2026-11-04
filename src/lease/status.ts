import { mkdirSync, readFileSync } from "node:fs";

import { skipReason } from "./acquire.js";
import { laneUse, readQueue } from "./admit.js";
import { DISABLE_ENV, type LeaseSettings } from "./config.js";
import { etas, graceRuns, logLines, runMedians } from "./estimate.js";
import {
  describeRecord,
  epoch,
  leaseHeld,
  leasePaths,
  readRecord,
  type LeaseRecord,
} from "./files.js";
import { hostSettled, hostSources, readHost } from "./host.js";
import { outsideLease, type OutsideProcess } from "./procs.js";

// The first lines keep the shell wrapper's shape (lease, host, settled, holder, waiter) for
// readers that parse them, with pmcp's fields appended; pmcp's own lines come after.

export interface StatusOptions {
  readonly settings: LeaseSettings;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly outside?: (holders: readonly number[]) => readonly OutsideProcess[];
}

function hostLine(
  settings: LeaseSettings,
  load: string | null,
  io: string | null,
) {
  return `host: load1 ${load ?? "n/a"} (max ${settings.maxLoad}), io some avg10 ${io ?? "n/a"} (max ${settings.maxIo})`;
}

function holdLine(settings: LeaseSettings, job: LeaseRecord): string {
  const held = epoch() - job.since;
  const limits = `warn ${settings.holdWarn}s${settings.holdMax ? `, max ${settings.holdMax}s` : ""}`;
  let verdict = "ok";
  if (held >= settings.holdWarn) verdict = "warning: over hold_warn";
  if (settings.holdMax && held >= settings.holdMax)
    verdict = "over-limit: over hold_max";
  return `hold: pid ${job.pid} ${held}s (${limits}) ${verdict} lane ${job.lane} weight ${job.weight}`;
}

function outsideLines(found: readonly OutsideProcess[]): string[] {
  if (found.length === 0) return ["outside: none"];
  return found.map(
    (item) =>
      `outside: pid ${item.pid} cpu ${item.cpu.toFixed(0)}% io ${item.ioMbps.toFixed(1)}MB/s ${item.command}`,
  );
}

function settledLine(settings: LeaseSettings, env: StatusOptions["env"]) {
  const paths = leasePaths(settings.dir);
  if (hostSettled(settings, paths, hostSources(env))) return "settled: now";
  let last = "never";
  try {
    last = readFileSync(paths.settled, "utf8").trim() || "never";
  } catch {
    // Never seen settled.
  }
  return `settled: last seen ${last}`;
}

export function leaseStatus(options: StatusOptions): string[] {
  const { settings, env } = options;
  const paths = leasePaths(settings.dir);
  const reading = readHost(hostSources(env));
  const host = hostLine(settings, reading.load, reading.io);
  if (!settings.enabled)
    return ["lease: disabled ([host.lease] enabled = false)", host];
  try {
    mkdirSync(paths.dir, { recursive: true });
  } catch {
    // Status still reads what it can.
  }
  const lines = [`lease: ${paths.lock}`, host, settledLine(settings, env)];
  const held = leaseHeld(paths);
  lines.push(
    held
      ? `holder: ${describeRecord(readRecord(paths.holder))}`
      : "holder: none",
  );
  const { running, waiters } = readQueue(paths);
  const log = logLines(paths.log);
  const eta = etas(runMedians(log), settings.budget, running, waiters, epoch());
  waiters.forEach((waiter, at) => {
    const guess = eta[at];
    const tail = guess === null || guess === undefined ? "" : ` eta ~${guess}s`;
    lines.push(
      `waiter: ${describeRecord(waiter)} lane ${waiter.lane} weight ${waiter.weight} position ${at + 1}${tail}${waiter.id ? ` id ${waiter.id}` : ""}`,
    );
  });
  if (waiters.length === 0) lines.push("waiters: none");
  lines.push(`lanes: ${laneUse(settings, running)}`);
  for (const job of running) lines.push(`running: ${describeRecord(job)}`);
  for (const job of running.filter((entry) => entry.bypass))
    lines.push(
      `bypass running: pid ${job.pid}, reason ${job.bypass}, since ${epoch() - job.since}s`,
    );
  for (const job of running) lines.push(holdLine(settings, job));
  const window = reading.pressure[settings.ioWindow] ?? "n/a";
  lines.push(
    `io: the host check reads some ${settings.ioWindow} ${window} (max ${settings.maxIo}, hard ${settings.maxIo * settings.hardFactor})`,
  );
  const grace = graceRuns(log);
  lines.push(
    grace.count === 0
      ? "grace: no job started on load_grace in the last 24h"
      : `grace: ${grace.count} job(s) started on load_grace in the last 24h, last ${grace.last}`,
  );
  const outside =
    options.outside ?? ((pids) => outsideLease({ holders: pids }));
  lines.push(...outsideLines(outside(running.map((job) => job.pid))));
  const skip = skipReason(settings, env);
  if (skip !== null)
    lines.push(
      `skip: this shell runs without the lease (${DISABLE_ENV}): ${skip}`,
    );
  return lines;
}
