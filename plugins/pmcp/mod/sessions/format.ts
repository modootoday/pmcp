// Keep format definitions dependency-free so the mod can ship the same store contract.

import type { Broadcast, Lease, Pause, SessionRecord } from "./types";

export const STATE_FILES = {
  records: "fleet",
  pause: "pause.json",
  broadcast: "broadcast.json",
  history: "broadcast-history.jsonl",
} as const;

export const STALE_MS = 30 * 60 * 1000;

const LEASE_NAME = /^[a-z0-9][a-z0-9_-]*$/u;

// Preserve the existing lockfile lease filename so delivery and hook readers remain compatible.
export function leaseFile(name: string): string {
  if (!LEASE_NAME.test(name)) throw new Error(`invalid lease name ${name}`);
  return `${name}-lease.json`;
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
