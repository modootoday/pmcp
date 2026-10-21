import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { flockAvailable, lockFile } from "../../locks/file-lock.js";

export interface HostLock {
  release(): void;
}

export interface Holder {
  readonly tip: string;
  readonly subject: string;
  readonly checkout: string;
  readonly pid: number;
  readonly startedAt: string;
}

// Keep the inherited descriptor open so the host lock outlives the flock child.
function flock(fd: number, args: readonly string[]): number {
  const run = spawnSync("flock", [...args, "3"], {
    stdio: ["ignore", "ignore", "pipe", fd],
  });
  if (run.error !== undefined)
    throw new Error(`flock (util-linux) is required: ${run.error.message}`);
  return run.status ?? 1;
}

export function acquireHostLock(
  path: string,
  waitSeconds: number,
  onWait?: () => void,
): HostLock | null {
  mkdirSync(dirname(path), { recursive: true });
  // Linux keeps flock: the workspace's own land and gate scripts take this lock with flock too.
  if (!flockAvailable()) {
    const now = lockFile(path, 0);
    if (now) return now;
    onWait?.();
    return lockFile(path, waitSeconds * 1000);
  }
  const fd = openSync(path, "a");
  try {
    if (flock(fd, ["-n"]) !== 0) {
      onWait?.();
      if (flock(fd, ["-w", String(waitSeconds)]) !== 0) {
        closeSync(fd);
        return null;
      }
    }
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  let open = true;
  return {
    release: () => {
      if (!open) return;
      open = false;
      closeSync(fd);
    },
  };
}

export function holderFile(lockPath: string): string {
  return join(dirname(lockPath), "holder.json");
}

export function writeHolder(
  lockPath: string,
  holder: Omit<Holder, "pid" | "startedAt">,
): void {
  const record: Holder = {
    ...holder,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(holderFile(lockPath), `${JSON.stringify(record)}\n`);
}

export function removeHolder(lockPath: string): void {
  rmSync(holderFile(lockPath), { force: true });
}

export function readHolder(lockPath: string): Holder | null {
  try {
    return JSON.parse(readFileSync(holderFile(lockPath), "utf8")) as Holder;
  } catch {
    return null;
  }
}
