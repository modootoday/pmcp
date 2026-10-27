// Keep format definitions dependency-free so the mod can ship the same store contract.

import type { Broadcast, Lease, Pause, SessionRecord } from "./types";

export const STATE_FILES = {
  records: "sessions",
  // The records' former directory. Deprecated: 0.20 still writes every record there too and
  // reads it when sessions/ lacks one; 0.21 stops writing it.
  legacyRecords: "fleet",
  pause: "pause.json",
  broadcast: "broadcast.json",
  history: "broadcast-history.jsonl",
} as const;

export const STALE_MS = 30 * 60 * 1000;

// Of a session's copies (sessions/ and fleet/), the one updated last; the first wins a tie.
export function latestRecord(
  copies: readonly (SessionRecord | null)[],
): SessionRecord | null {
  const time = (record: SessionRecord) =>
    Date.parse(record.updatedAt ?? record.startedAt ?? "") || 0;
  let latest: SessionRecord | null = null;
  for (const copy of copies)
    if (copy && (!latest || time(copy) > time(latest))) latest = copy;
  return latest;
}

const LEASE_NAME = /^[a-z0-9][a-z0-9_-]*$/u;

// The lease file name is part of the shared formats (docs/git-workflow.md); never change it.
export function leaseFile(name: string): string {
  if (!LEASE_NAME.test(name)) throw new Error(`invalid lease name ${name}`);
  return `${name}-lease.json`;
}

// A file leaseFile could have named, so a reader can find every lease without the configuration.
export function isLeaseFile(file: string): boolean {
  return (
    file.endsWith("-lease.json") &&
    LEASE_NAME.test(file.slice(0, -"-lease.json".length))
  );
}

type Fields = Record<string, unknown>;

const text = (value: unknown): value is string => typeof value === "string";

export function fieldsOf(value: unknown): Fields | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  return value as Fields;
}

export function asPause(value: unknown): Pause | null {
  const fields = fieldsOf(value);
  if (
    !fields ||
    !text(fields["by"]) ||
    !text(fields["reason"]) ||
    !text(fields["since"])
  )
    return null;
  return { by: fields["by"], reason: fields["reason"], since: fields["since"] };
}

export function asLease(value: unknown): Lease | null {
  const fields = fieldsOf(value);
  if (!fields || typeof fields["pid"] !== "number" || !text(fields["subject"]))
    return null;
  const cwd = text(fields["cwd"]) ? { cwd: fields["cwd"] } : {};
  return {
    pid: fields["pid"],
    subject: fields["subject"],
    since: text(fields["since"]) ? fields["since"] : "",
    ...cwd,
  };
}

export function asBroadcast(value: unknown): Broadcast | null {
  const fields = fieldsOf(value);
  if (
    !fields ||
    !text(fields["id"]) ||
    !text(fields["by"]) ||
    !text(fields["text"]) ||
    !text(fields["since"])
  ) {
    return null;
  }
  return {
    id: fields["id"],
    by: fields["by"],
    text: fields["text"],
    since: fields["since"],
  };
}

export function asRecord(value: unknown): SessionRecord | null {
  const fields = fieldsOf(value);
  if (!fields || !text(fields["session"])) return null;
  return fields as SessionRecord;
}

export function recordLive(
  record: SessionRecord,
  now: number,
  pidAlive: boolean,
  staleMs = STALE_MS,
): boolean {
  if (record.pid !== undefined) return pidAlive;
  const beat = Date.parse(record.updatedAt ?? "");
  return Number.isFinite(beat) && now - beat < staleMs;
}
