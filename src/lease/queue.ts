import { readFileSync } from "node:fs";

import { inferSession } from "../sessions/identity.js";
import {
  epoch,
  liveWaiters,
  type LeaseLane,
  type LeasePaths,
} from "./files.js";
import { sleepSeconds } from "./host.js";

// The agent session's id where the runtime exposes one, else the process group, else the
// directory: parallel subagents of one session share the first.
export function sessionOf(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): string {
  const inferred = inferSession(env, [], []).session;
  if (inferred) return inferred;
  try {
    const stat = readFileSync("/proc/self/stat", "utf8");
    const group = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2];
    if (group) return `pgid:${group}`;
  } catch {
    // Not Linux: the directory names the session.
  }
  return `cwd:${cwd}`;
}

const CAPPED: readonly LeaseLane[] = ["interactive", "bulk"];

export interface Park {
  readonly paths: LeasePaths;
  readonly lane: LeaseLane;
  readonly session: string;
  readonly cap: number;
  readonly maxWait: number;
  readonly say: (line: string) => void;
}

// One session may queue only `cap` jobs per interactive or bulk lane; the next waits outside
// the queue, unregistered, so it holds no place. Returns the seconds spent, or null at max_wait.
export function parkForSession(park: Park): number | null {
  if (park.cap === 0 || !CAPPED.includes(park.lane)) return 0;
  const started = epoch();
  const queued = () =>
    liveWaiters(park.paths).filter(
      (record) => record.session === park.session && record.lane === park.lane,
    ).length;
  let count = queued();
  if (count < park.cap) return 0;
  park.say(
    `parked outside the queue: this session already has ${count} queued ${park.lane} job(s) (per_session ${park.cap})`,
  );
  for (;;) {
    if (epoch() - started >= park.maxWait) return null;
    sleepSeconds(1);
    count = queued();
    if (count < park.cap) return epoch() - started;
  }
}
