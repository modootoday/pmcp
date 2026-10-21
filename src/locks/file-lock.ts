import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  closeSync,
  constants,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";

// Exclusive locks on Linux and macOS. Where the util-linux flock command exists (Linux) it is
// used, so other tools taking the same lock with flock keep excluding pmcp. Elsewhere (macOS)
// a lock file made with O_EXCL names its owner; a dead owner's file is stale and taken over.
export interface FileLock {
  release(): void;
}

interface Owner {
  readonly pid: number;
  readonly start: string;
}

let flockSeen: boolean | undefined;

export function flockAvailable(): boolean {
  flockSeen ??=
    spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;
  return flockSeen;
}

// The start time tells a live owner from a new process that reuses its pid.
export function processStart(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      const text = readFileSync(`/proc/${pid}/stat`, "utf8");
      return text.slice(text.lastIndexOf(")") + 2).split(" ")[19] ?? null;
    } catch {
      return null;
    }
  }
  const run = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const start = run.status === 0 ? run.stdout.trim() : "";
  return start || null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function owner(path: string): Owner | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Owner;
    return Number.isInteger(value.pid) ? value : null;
  } catch {
    return null;
  }
}

function stale(found: Owner | null): boolean {
  if (!found) return true;
  return !alive(found.pid) || processStart(found.pid) !== found.start;
}

function tryCreate(path: string, me: Owner): boolean {
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, `${JSON.stringify(me)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

// A stale file is moved aside before removal, so two processes cannot both remove it and then
// both believe the new file is theirs.
function takeOver(path: string, me: Owner): boolean {
  if (tryCreate(path, me)) return true;
  if (!stale(owner(path))) return false;
  const aside = `${path}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(path, aside);
    unlinkSync(aside);
  } catch {
    return false;
  }
  return tryCreate(path, me);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The lock-file lock: null when another live owner still holds it after waitMs. */
export function lockFile(path: string, waitMs: number): FileLock | null {
  const me = { pid: process.pid, start: processStart(process.pid) ?? "" };
  const end = Date.now() + waitMs;
  while (!takeOver(path, me)) {
    if (Date.now() >= end) return null;
    sleep(100);
  }
  let held = true;
  return {
    release: () => {
      if (!held) return;
      held = false;
      if (owner(path)?.pid === process.pid) unlinkSync(path);
    },
  };
}

/** Async lockFile for callers on the event loop. */
export async function lockFileAsync(
  path: string,
  waitMs: number,
): Promise<FileLock | null> {
  const end = Date.now() + waitMs;
  for (;;) {
    const lock = lockFile(path, 0);
    if (lock || Date.now() >= end) return lock;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Runs argv while holding the lock, as flock LOCK [options] argv did: status 73 when the lock
 * stays busy for waitSeconds (0 is no wait).
 */
export function runLocked(
  lock: string,
  waitSeconds: number,
  argv: readonly [string, ...string[]],
  options: Parameters<typeof spawnSync>[2] & { encoding: "utf8" },
): SpawnSyncReturns<string> {
  if (flockAvailable()) {
    const wait =
      waitSeconds > 0 ? ["--wait", String(waitSeconds)] : ["--nonblock"];
    const flags = [...wait, "--close", "--conflict-exit-code", "73", lock];
    return spawnSync("flock", [...flags, ...argv], options);
  }
  const held = lockFile(lock, waitSeconds * 1000);
  if (!held) {
    const busy = { status: 73, stdout: "", stderr: "", output: [] };
    return { ...busy, pid: 0, signal: null } as SpawnSyncReturns<string>;
  }
  try {
    return spawnSync(argv[0], argv.slice(1), options);
  } finally {
    held.release();
  }
}
