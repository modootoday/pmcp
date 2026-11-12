import { closeSync, openSync } from "node:fs";
import { join } from "node:path";

import { flock } from "../git/mainline/lock.js";
import type { LeaseSettings } from "./config.js";
import {
  LANES,
  liveRecords,
  type LeaseLane,
  type LeaseRecord,
  type LeasePaths,
} from "./files.js";

// Which waiters may start now. In admission order (lane, then oldest), each waiter whose lane
// has a free slot takes it if its weight fits the budget left; the first one the budget cannot
// fit stops the rest, so a short budget goes by priority and a heavy job is not starved by
// lighter ones behind it. A full lane only skips that waiter.
export function admissible(
  settings: LeaseSettings,
  running: readonly LeaseRecord[],
  waiters: readonly LeaseRecord[],
): Set<number> {
  const gateOnly = settings.gateAlone && gateWanted(running, waiters);
  const free = { ...settings.slots };
  let budget = settings.budget;
  for (const job of running) {
    if (job.weight === 0) continue;
    free[job.lane] -= 1;
    budget -= job.weight;
  }
  // A tiny job (weight 0) takes no slot and no budget; only the host check holds it.
  const found = new Set(
    waiters.filter((waiter) => waiter.weight === 0).map((w) => w.pid),
  );
  for (const waiter of waiters) {
    if (waiter.weight === 0 || free[waiter.lane] <= 0) continue;
    if (gateOnly && waiter.lane !== "gate") continue;
    if (waiter.weight > budget) break;
    free[waiter.lane] -= 1;
    budget -= waiter.weight;
    found.add(waiter.pid);
  }
  return found;
}

// A gate that runs or waits: with gate_alone no other weighted job starts beside it, or both
// may enter on the same poll once the host calms, as a land's gate and a test run once did.
function gateWanted(
  running: readonly LeaseRecord[],
  waiters: readonly LeaseRecord[],
): boolean {
  return [...running, ...waiters].some(
    (job) => job.lane === "gate" && job.weight > 0,
  );
}

export function runningWeight(running: readonly LeaseRecord[]): number {
  return running.reduce((sum, job) => sum + job.weight, 0);
}

export function laneUse(
  settings: LeaseSettings,
  running: readonly LeaseRecord[],
): string {
  const used = (lane: LeaseLane) =>
    running.filter((job) => job.lane === lane).length;
  const lanes = LANES.map(
    (lane) => `${lane} ${used(lane)}/${settings.slots[lane]}`,
  ).join(" ");
  return `${lanes}, weight ${runningWeight(running)}/${settings.budget}`;
}

// The short critical section every admission and release runs in, so two waiters can never
// both see the same free budget.
export function underAdmitLock<T>(paths: LeasePaths, act: () => T): T | null {
  const fd = openSync(paths.admit, "a");
  try {
    if (flock(fd, ["-w", "10"]) !== 0) return null;
    return act();
  } finally {
    closeSync(fd);
  }
}

export interface Queue {
  readonly running: LeaseRecord[];
  readonly waiters: LeaseRecord[];
}

// Dead processes' records are dropped on every read.
export function readQueue(paths: LeasePaths, prune = true): Queue {
  return {
    running: liveRecords(paths.running, prune),
    waiters: liveRecords(paths.waiters, prune),
  };
}

export function runningFile(paths: LeasePaths, pid: number): string {
  return join(paths.running, String(pid));
}

export function waiterFile(paths: LeasePaths, pid: number): string {
  return join(paths.waiters, String(pid));
}
