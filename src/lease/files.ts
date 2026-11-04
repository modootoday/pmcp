import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// The on-disk protocol extends the one shell lease wrappers already use (key=value records, a
// tab-separated log; pmcp only appends fields), so a shell holder and pmcp read each other.

export interface LeasePaths {
  readonly dir: string;
  readonly lock: string;
  readonly admit: string;
  readonly holder: string;
  readonly waiters: string;
  readonly running: string;
  readonly settled: string;
  readonly log: string;
  readonly usage: string;
  readonly released: string;
}

// Lanes in the order a short budget goes to them: a land gate, commit-hook work, what a
// session runs now, then batch work.
export type LeaseLane = "gate" | "hook" | "interactive" | "bulk";
export const LANES: readonly LeaseLane[] = [
  "gate",
  "hook",
  "interactive",
  "bulk",
];

export interface LeaseRecord {
  readonly pid: number;
  readonly since: number;
  readonly started: string;
  readonly cwd: string;
  readonly label: string;
  // Absent in a shell wrapper's records, which then count as interactive, weight 1.
  readonly lane: LeaseLane;
  readonly weight: number;
  readonly queued: number;
  readonly session: string;
  // Set for a job started with --now: it skipped the queue for this reason.
  readonly bypass: string;
  // Started on load_grace, into moderate overload.
  readonly grace: boolean;
  // A stable id (a ticket's, or one made for a blocking run) and queue control requests.
  readonly id: string;
  readonly promote: string;
  readonly cancel: string;
}

export interface RecordFields {
  readonly cwd: string;
  readonly label: string;
  readonly lane: LeaseLane;
  readonly weight: number;
  readonly session: string;
  readonly queued?: number;
  readonly bypass?: string;
  readonly grace?: boolean;
  readonly id?: string;
  readonly promote?: string;
  readonly cancel?: string;
  // Kept when a record is rewritten, so a moved waiter keeps its age.
  readonly since?: number;
  readonly started?: string;
}

export function leasePaths(dir: string): LeasePaths {
  return {
    dir,
    lock: join(dir, "heavy.lock"),
    admit: join(dir, "admit.lock"),
    holder: join(dir, "heavy.holder"),
    waiters: join(dir, "waiters"),
    running: join(dir, "running"),
    settled: join(dir, "heavy.settled"),
    log: join(dir, "heavy.log"),
    usage: join(dir, "usage.jsonl"),
    released: join(dir, "heavy.released"),
  };
}

export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

export function epoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function newId(): string {
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `${epoch()}-${random}`;
}

export function oneLine(text: string): string {
  return text.replace(/[\n\t]/gu, " ").slice(0, 200);
}

export function writeRecord(
  file: string,
  pid: number,
  fields: RecordFields,
): void {
  const temporary = `${file}.tmp.${pid}`;
  const lines = [
    `pid=${pid}`,
    `since=${fields.since ?? epoch()}`,
    `started=${fields.started ?? nowUtc()}`,
    `cwd=${fields.cwd}`,
    `label=${fields.label}`,
    `lane=${fields.lane}`,
    `weight=${fields.weight}`,
    `queued=${fields.queued ?? Date.now()}`,
    `session=${fields.session}`,
    ...(fields.bypass ? [`bypass=${fields.bypass}`] : []),
    ...(fields.grace ? ["grace=1"] : []),
    ...(fields.id ? [`id=${fields.id}`] : []),
    ...(fields.promote ? [`promote=${fields.promote}`] : []),
    ...(fields.cancel ? [`cancel=${fields.cancel}`] : []),
  ];
  writeFileSync(temporary, `${lines.join("\n")}\n`);
  renameSync(temporary, file);
}

export function readRecord(file: string): LeaseRecord | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const field = (name: string) =>
    text
      .split("\n")
      .find((line) => line.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? "";
  const pid = Number(field("pid"));
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const since = Number(field("since")) || epoch();
  const lane = field("lane") as LeaseLane;
  return {
    pid,
    since,
    started: field("started"),
    cwd: field("cwd"),
    label: field("label"),
    lane: LANES.includes(lane) ? lane : "interactive",
    weight: Number(field("weight")) || 1,
    queued: Number(field("queued")) || since * 1000,
    session: field("session"),
    bypass: field("bypass"),
    grace: field("grace") === "1",
    id: field("id"),
    promote: field("promote"),
    cancel: field("cancel"),
  };
}

export function removeRecord(file: string, pid: number): void {
  if (readRecord(file)?.pid === pid) rmSync(file, { force: true });
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// A separate open file description, so it is refused while anyone, this process too, holds it.
export function leaseHeld(paths: LeasePaths): boolean {
  if (!existsSync(paths.lock)) return false;
  return spawnSync("flock", ["-n", paths.lock, "true"]).status !== 0;
}

export function logEvent(
  paths: LeasePaths,
  pid: number,
  event: string,
  detail: string,
): void {
  try {
    mkdirSync(paths.dir, { recursive: true });
    appendFileSync(paths.log, `${nowUtc()}\t${pid}\t${event}\t${detail}\n`);
  } catch {
    // The log is a record for people; a full disk must not stop the command.
  }
}

// Live records of a directory in admission order: by lane, then oldest first. A dead
// process's record is removed on the way.
export function liveRecords(dir: string, prune = true): LeaseRecord[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found: LeaseRecord[] = [];
  for (const name of names) {
    if (name.includes(".tmp.")) continue;
    const file = join(dir, name);
    const record = readRecord(file);
    if (record === null || !pidAlive(record.pid)) {
      if (prune) rmSync(file, { force: true });
      continue;
    }
    found.push(record);
  }
  const rank = (record: LeaseRecord) => LANES.indexOf(record.lane);
  return found.sort(
    (a, b) => rank(a) - rank(b) || a.queued - b.queued || a.pid - b.pid,
  );
}

export function liveWaiters(paths: LeasePaths): LeaseRecord[] {
  return liveRecords(paths.waiters);
}

export function describeRecord(record: LeaseRecord | null): string {
  if (record === null) return "an unrecorded process";
  if (!pidAlive(record.pid))
    return `a new holder (last record: pid ${record.pid} ${record.label}, gone)`;
  return `pid ${record.pid} ${record.label} (cwd ${record.cwd}, ${epoch() - record.since}s)`;
}
