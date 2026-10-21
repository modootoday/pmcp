import {
  asBroadcast,
  asLease,
  asPause,
  asRecord,
  leaseFile,
  recordLive,
  STATE_FILES,
} from "../sessions/format";
import type {
  ReadOptions,
  SessionRecord,
  SessionSnapshot,
  StateFiles,
} from "./types";

export { STALE_MS } from "../sessions/format";

export const STATE_PATHS = {
  records: STATE_FILES.records,
  pause: STATE_FILES.pause,
  lease: leaseFile("lockfile"),
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
  const directory = `${options.stateDir}/${STATE_PATHS.records}`;
  const names = await files.list(directory).catch(() => [] as string[]);
  const records: SessionRecord[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const record = asRecord(await readJson(files, `${directory}/${name}`));
    if (!record) continue;
    const pidAlive = await isAlive(files, record.pid);
    if (recordLive(record, options.now, pidAlive)) records.push(record);
  }
  return records;
}

export async function readSessionState(
  files: StateFiles,
  options: ReadOptions,
): Promise<SessionSnapshot> {
  const at = (name: string) => `${options.stateDir}/${name}`;
  const lease = asLease(await readJson(files, at(STATE_PATHS.lease)));
  return {
    records: await readRecords(files, options),
    pause: asPause(await readJson(files, at(STATE_PATHS.pause))),
    lease: lease && (await isAlive(files, lease.pid)) ? lease : null,
    broadcast: asBroadcast(await readJson(files, at(STATE_PATHS.broadcast))),
  };
}
