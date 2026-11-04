import { closeSync, fstatSync, openSync, readSync } from "node:fs";

import { LANES, type LeaseLane, type LeaseRecord } from "./files.js";

// Median run time per lane from the log's recent acquired/released pairs, so status can say
// roughly how long a waiter's queue ahead takes. Lines without lane= are interactive.

const TAIL_BYTES = 512 * 1024;

function tail(file: string): string {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return "";
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export type Medians = Partial<Record<LeaseLane | "all", number>>;

export interface GraceRuns {
  readonly count: number;
  readonly last: string | null;
}

export function logLines(log: string): string[][] {
  return tail(log)
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((fields) => fields.length >= 4);
}

export function runMedians(lines: readonly string[][]): Medians {
  const open = new Map<string, LeaseLane>();
  const runs: Record<string, number[]> = { all: [] };
  for (const [, pid = "", event, detail = ""] of lines) {
    if (event === "acquired") {
      const named = detail.match(/ lane=(\w+)/u)?.[1] as LeaseLane;
      open.set(pid, LANES.includes(named) ? named : "interactive");
    } else if (event === "released") {
      const lane = open.get(pid);
      const ran = Number(detail.match(/^ran=(\d+)/u)?.[1]);
      if (lane === undefined || !Number.isFinite(ran)) continue;
      open.delete(pid);
      (runs[lane] ??= []).push(ran);
      runs["all"]!.push(ran);
    }
  }
  const found: Medians = {};
  for (const [key, values] of Object.entries(runs)) {
    const value = median(values);
    if (value !== undefined) found[key as LeaseLane | "all"] = value;
  }
  return found;
}

// Jobs that started on load_grace in the last day, so how often the host was overrun is measured.
export function graceRuns(
  lines: readonly string[][],
  now = Date.now(),
): GraceRuns {
  const recent = lines.filter(
    ([stamp = "", , event]) =>
      event === "grace" && now - Date.parse(stamp) <= 86_400_000,
  );
  const last = recent.at(-1);
  return {
    count: recent.length,
    last: last ? `${last[0]} (${last[3]})` : null,
  };
}

// Seconds until each waiter's turn: weighted work ahead (what runs now, what queues ahead)
// spread over the budget. A rough guide, not a promise.
export function etas(
  medians: Medians,
  budget: number,
  running: readonly LeaseRecord[],
  waiters: readonly LeaseRecord[],
  now: number,
): (number | null)[] {
  if (medians["all"] === undefined) return waiters.map(() => null);
  const typical = (lane: LeaseLane) => medians[lane] ?? medians["all"] ?? 0;
  let work = running.reduce(
    (sum, job) =>
      sum + Math.max(0, typical(job.lane) - (now - job.since)) * job.weight,
    0,
  );
  return waiters.map((waiter) => {
    const mine = Math.round(work / Math.max(1, budget));
    work += typical(waiter.lane) * waiter.weight;
    return mine;
  });
}
