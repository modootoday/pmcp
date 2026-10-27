import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ArgumentError } from "../../cli/command.js";
import {
  asBroadcast,
  asLease,
  asPause,
  asRecord,
  fieldsOf,
  leaseFile,
  STATE_FILES,
} from "../../sessions/format.js";
import { writeJson } from "../../sessions/files/json.js";
import { SESSION_ID } from "../../sessions/files/registry.js";
import type { SessionStore } from "../../sessions/types.js";

export function seedState(
  store: SessionStore,
  cwd: string,
  path?: string,
): void {
  if (!path) return;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(cwd, path), "utf8"));
  } catch {
    throw new ArgumentError("--session-state must be a readable JSON object");
  }
  const raw = fieldsOf(value);
  if (!raw) throw new ArgumentError("--session-state must be an object");
  const unknown = Object.keys(raw).find(
    (key) => !["records", "pause", "leases", "broadcast"].includes(key),
  );
  if (unknown) throw new ArgumentError("unknown session-state key " + unknown);
  if (raw.records !== undefined && !Array.isArray(raw.records))
    throw new ArgumentError("records must be an array");
  for (const value of (raw.records ?? []) as unknown[]) {
    const record = asRecord(value);
    if (!record || !SESSION_ID.test(record.session))
      throw new ArgumentError("records need valid session identifiers");
    writeJson(
      join(store.dir, STATE_FILES.records, record.session + ".json"),
      record,
    );
  }
  if (raw.pause !== undefined && raw.pause !== null) {
    const pause = asPause(raw.pause);
    if (!pause) throw new ArgumentError("pause needs by, reason and since");
    writeJson(join(store.dir, STATE_FILES.pause), pause);
  }
  if (raw.leases !== undefined && !fieldsOf(raw.leases))
    throw new ArgumentError("leases must be an object");
  for (const [name, value] of Object.entries((raw.leases ?? {}) as object)) {
    const lease = asLease(value);
    if (!lease) throw new ArgumentError("lease needs pid and subject");
    writeJson(join(store.dir, leaseFile(name)), lease);
  }
  if (raw.broadcast !== undefined && raw.broadcast !== null) {
    const broadcast = asBroadcast(raw.broadcast);
    if (!broadcast)
      throw new ArgumentError("broadcast needs id, by, text and since");
    writeJson(join(store.dir, STATE_FILES.broadcast), broadcast);
  }
}
