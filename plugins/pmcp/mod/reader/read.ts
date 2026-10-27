import {
  asBroadcast,
  asLease,
  asPause,
  asRecord,
  isLeaseFile,
  recordLive,
  STATE_FILES,
} from "../sessions/format";
import type {
  Lease,
  ReadOptions,
  SessionRecord,
  SessionSnapshot,
  StateFiles,
} from "./types";

export { STALE_MS } from "../sessions/format";

export const STATE_PATHS = {
  records: STATE_FILES.records,
  pause: STATE_FILES.pause,
  broadcast: STATE_FILES.broadcast,
} as const;

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readJson(files: StateFiles, path: string): Promise<unknown> {
  if (!(await files.exists(path))) return null;
  return parse(await files.read(path).catch(() => ""));
}

export async function isAlive(
  files: StateFiles,
  pid: unknown,
): Promise<boolean> {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  return files.exists(`/proc/${value}`);
}

export async function readRecords(
  files: StateFiles,
  options: ReadOptions,
): Promise<SessionRecord[]> {
  // sessions/ first; the deprecated fleet/ adds records written before 0.20.
  const seen = new Set<string>();
  const records: SessionRecord[] = [];
  for (const folder of [STATE_PATHS.records, STATE_FILES.legacyRecords]) {
    const directory = `${options.stateDir}/${folder}`;
    const names = await files.list(directory).catch(() => [] as string[]);
    for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
      if (seen.has(name)) continue;
      const record = asRecord(await readJson(files, `${directory}/${name}`));
      if (!record) continue;
      seen.add(name);
      const pidAlive = await isAlive(files, record.pid);
      if (recordLive(record, options.now, pidAlive)) records.push(record);
    }
  }
  return records.sort((a, b) => a.session.localeCompare(b.session));
}

// Every live lease in the state directory, whatever its name; the one held longest is shown.
export async function readLease(
  files: StateFiles,
  options: ReadOptions,
): Promise<Lease | null> {
  const names = await files.list(options.stateDir).catch(() => [] as string[]);
  let held: Lease | null = null;
  for (const name of names.filter(isLeaseFile).sort()) {
    const lease = asLease(await readJson(files, `${options.stateDir}/${name}`));
    if (!lease || !(await isAlive(files, lease.pid))) continue;
    if (!held || Date.parse(lease.since ?? "") < Date.parse(held.since ?? ""))
      held = lease;
  }
  return held;
}

export async function readSessionState(
  files: StateFiles,
  options: ReadOptions,
): Promise<SessionSnapshot> {
  const at = (name: string) => `${options.stateDir}/${name}`;
  return {
    records: await readRecords(files, options),
    pause: asPause(await readJson(files, at(STATE_PATHS.pause))),
    lease: await readLease(files, options),
    broadcast: asBroadcast(await readJson(files, at(STATE_PATHS.broadcast))),
  };
}
