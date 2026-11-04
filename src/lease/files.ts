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

// The on-disk protocol is the one shell lease wrappers already use (key=value records, a
// tab-separated log), so a shell holder and a pmcp waiter read each other's files.

export interface LeasePaths {
  readonly dir: string;
  readonly lock: string;
  readonly holder: string;
  readonly waiters: string;
  readonly settled: string;
  readonly log: string;
}

export interface LeaseRecord {
  readonly pid: number;
  readonly since: number;
  readonly started: string;
  readonly cwd: string;
  readonly label: string;
}

export function leasePaths(dir: string): LeasePaths {
  return {
    dir,
    lock: join(dir, "heavy.lock"),
    holder: join(dir, "heavy.holder"),
    waiters: join(dir, "waiters"),
    settled: join(dir, "heavy.settled"),
    log: join(dir, "heavy.log"),
  };
}

export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

export function epoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function oneLine(text: string): string {
  return text.replace(/[\n\t]/gu, " ").slice(0, 200);
}

export function writeRecord(
  file: string,
  pid: number,
  cwd: string,
  label: string,
): void {
  const temporary = `${file}.tmp.${pid}`;
  const lines = [
    `pid=${pid}`,
    `since=${epoch()}`,
    `started=${nowUtc()}`,
    `cwd=${cwd}`,
    `label=${label}`,
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
  return {
    pid,
    since: Number(field("since")) || epoch(),
    started: field("started"),
    cwd: field("cwd"),
    label: field("label"),
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

// Live waiters oldest first; a dead one's file is removed on the way.
export function liveWaiters(paths: LeasePaths): LeaseRecord[] {
  let names: string[];
  try {
    names = readdirSync(paths.waiters);
  } catch {
    return [];
  }
  const found: LeaseRecord[] = [];
  for (const name of names) {
    if (name.includes(".tmp.")) continue;
    const file = join(paths.waiters, name);
    const record = readRecord(file);
    if (record === null || !pidAlive(record.pid)) {
      rmSync(file, { force: true });
      continue;
    }
    found.push(record);
  }
  return found.sort((a, b) => a.since - b.since || a.pid - b.pid);
}

export function describeRecord(record: LeaseRecord | null): string {
  if (record === null) return "an unrecorded process";
  if (!pidAlive(record.pid))
    return `a new holder (last record: pid ${record.pid} ${record.label}, gone)`;
  return `pid ${record.pid} ${record.label} (cwd ${record.cwd}, ${epoch() - record.since}s)`;
}
