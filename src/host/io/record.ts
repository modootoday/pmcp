import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MODEL_KEYS, type IoModel } from "./model.js";

// The measured model lives beside the host lease's own state, keyed by whole-disk major:minor,
// since the lease directory is already the one place every session on the host shares.

export interface DeviceRecord {
  readonly device: string;
  readonly measured_at: string;
  readonly pmcp: string;
  // The directory whose filesystem the probe file was made on.
  readonly dir: string;
  readonly seconds: number;
  readonly size_mb: number;
  readonly model: IoModel;
  readonly probes: Readonly<Record<string, unknown>>;
  // The io.cost lines live when it ran: a qos cap at the old model bounds what a probe can see.
  readonly live_model: string | null;
  readonly live_qos: string | null;
}

export interface IoRecord {
  readonly version: 1;
  readonly devices: Readonly<Record<string, DeviceRecord>>;
}

export const RECORD_FILE = "io-model.json";

export function recordPath(leaseDir: string): string {
  return join(leaseDir, RECORD_FILE);
}

function validModel(value: unknown): value is IoModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Record<string, unknown>;
  return MODEL_KEYS.every(
    (key) =>
      typeof model[key] === "number" &&
      Number.isInteger(model[key]) &&
      (model[key] as number) > 0,
  );
}

// Null when there is no record; an unreadable or foreign one is an error to report, not to replace.
export function readRecord(leaseDir: string): IoRecord | null {
  let text: string;
  try {
    text = readFileSync(recordPath(leaseDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<IoRecord>;
  if (parsed.version !== 1 || typeof parsed.devices !== "object")
    throw new Error(`${recordPath(leaseDir)} is not a version 1 io record`);
  for (const [device, entry] of Object.entries(parsed.devices ?? {}))
    if (entry?.device !== device || !validModel(entry.model))
      throw new Error(`${recordPath(leaseDir)}: ${device} has no valid model`);
  return parsed as IoRecord;
}

export function writeRecord(leaseDir: string, entry: DeviceRecord): IoRecord {
  const current = readRecord(leaseDir);
  const next: IoRecord = {
    version: 1,
    devices: { ...(current?.devices ?? {}), [entry.device]: entry },
  };
  mkdirSync(leaseDir, { recursive: true });
  const path = recordPath(leaseDir);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
  renameSync(temp, path);
  return next;
}
