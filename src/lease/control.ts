import { readdirSync } from "node:fs";
import { join } from "node:path";

import { underAdmitLock } from "./admit.js";
import {
  LANES,
  liveRecords,
  logEvent,
  readRecord,
  writeRecord,
  type LeaseLane,
  type LeasePaths,
  type LeaseRecord,
} from "./files.js";

// Queue control by id: promote, move, cancel. Each change rewrites the waiter's record under the
// admission lock, where the waiting process reads it on its next poll, and is logged with who
// asked and why; the log is the control, since every caller is the same user.

export interface Who {
  readonly uid: number | null;
  readonly session: string;
}

export type ControlResult =
  | { readonly ok: true; readonly record: LeaseRecord }
  | { readonly ok: false; readonly why: string };

function find(paths: LeasePaths, dir: string, id: string) {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => /^\d+$/u.test(name));
  } catch {
    return null;
  }
  for (const name of names) {
    const record = readRecord(join(dir, name));
    if (record?.id === id) return { file: join(dir, name), record };
  }
  return null;
}

export function findRunning(paths: LeasePaths, id: string): LeaseRecord | null {
  return liveRecords(paths.running, false).find((r) => r.id === id) ?? null;
}

function rewrite(
  file: string,
  record: LeaseRecord,
  change: Partial<LeaseRecord>,
) {
  const next = { ...record, ...change };
  writeRecord(file, next.pid, {
    cwd: next.cwd,
    label: next.label,
    lane: next.lane,
    weight: next.weight,
    session: next.session,
    queued: next.queued,
    since: next.since,
    started: next.started,
    ...(next.id ? { id: next.id } : {}),
    ...(next.promote ? { promote: next.promote } : {}),
    ...(next.cancel ? { cancel: next.cancel } : {}),
  });
  return next;
}

function logged(
  paths: LeasePaths,
  record: LeaseRecord,
  who: Who,
  what: string,
  reason: string,
) {
  const by = `uid:${who.uid ?? "?"}${who.session ? ` session=${who.session}` : ""}`;
  logEvent(
    paths,
    record.pid,
    "control",
    `id=${record.id} ${what} by=${by} reason=${reason}`,
  );
}

function change(
  paths: LeasePaths,
  id: string,
  who: Who,
  reason: string,
  what: (
    record: LeaseRecord,
    waiters: LeaseRecord[],
  ) => [Partial<LeaseRecord>, string] | string,
): ControlResult {
  const done = underAdmitLock(paths, (): ControlResult => {
    const found = find(paths, paths.waiters, id);
    if (found === null) return { ok: false, why: `no waiting job ${id}` };
    // A waiter whose process died is reaped instead of changed.
    const waiters = liveRecords(paths.waiters);
    if (!waiters.some((r) => r.pid === found.record.pid))
      return { ok: false, why: `${id} had died; its record was removed` };
    const decided = what(found.record, waiters);
    if (typeof decided === "string") return { ok: false, why: decided };
    const [fields, description] = decided;
    const record = rewrite(found.file, found.record, fields);
    logged(paths, record, who, description, reason);
    return { ok: true, record };
  });
  return done ?? { ok: false, why: "the admission lock stayed busy" };
}

export function promote(
  paths: LeasePaths,
  id: string,
  who: Who,
  reason: string,
) {
  return change(paths, id, who, reason, () => [
    { promote: reason },
    "action=promote",
  ]);
}

export function cancelWaiter(
  paths: LeasePaths,
  id: string,
  who: Who,
  reason: string,
) {
  return change(paths, id, who, reason, () => [
    { cancel: reason },
    "action=cancel",
  ]);
}

// A lane name moves it to that lane's end; +N or -N moves it N places within its lane.
export function reprioritize(
  paths: LeasePaths,
  id: string,
  to: string,
  who: Who,
  reason: string,
): ControlResult {
  return change(paths, id, who, reason, (record, waiters) => {
    if (LANES.includes(to as LeaseLane))
      return [
        { lane: to as LeaseLane, queued: Date.now() },
        `action=priority from=${record.lane} to=${to}`,
      ];
    const step = /^[+-]\d+$/u.test(to) ? Number(to) : NaN;
    if (!Number.isInteger(step) || step === 0)
      return `priority is a lane (${LANES.join(", ")}) or +N/-N, not ${to}`;
    const lane = waiters.filter((r) => r.lane === record.lane);
    const at = lane.findIndex((r) => r.pid === record.pid);
    const target = Math.max(0, Math.min(lane.length - 1, at - step));
    if (target === at) return [{}, `action=priority ${to} (already there)`];
    const other = lane[target]!;
    const queued = target < at ? other.queued - 1 : other.queued + 1;
    return [
      { queued },
      `action=priority ${to} position=${at + 1}->${target + 1}`,
    ];
  });
}
