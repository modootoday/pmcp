import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { recordLive, STALE_MS } from "./format.js";
import type { SessionRecord } from "./types.js";

export { STALE_MS } from "./format.js";
const SHELLS = new Set(["sh", "bash", "dash", "zsh"]);

export function alive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// This process's ancestors, nearest first, as far as the system shows them.
export function ancestors(start = process.ppid, limit = 12): number[] {
  const chain: number[] = [];
  let pid = start;
  while (pid > 1 && chain.length < limit) {
    chain.push(pid);
    const info = stat(pid);
    if (!info) break;
    pid = info.parent;
  }
  return chain;
}

type ProcessInfo = { name: string; parent: number };

function stat(pid: number): ProcessInfo | null {
  if (process.platform === "darwin") return darwinTable().get(pid) ?? null;
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = text.lastIndexOf(")");
    const name = text.slice(text.indexOf("(") + 1, close);
    const parent = Number(text.slice(close + 2).split(" ")[1]);
    return { name, parent };
  } catch {
    return null;
  }
}

// macOS has no /proc: one ps listing per process gives every parent and command name.
let darwin: Map<number, ProcessInfo> | undefined;

function darwinTable(): Map<number, ProcessInfo> {
  if (darwin) return darwin;
  darwin = new Map();
  const run = spawnSync("ps", ["-A", "-o", "pid=,ppid=,comm="], {
    encoding: "utf8",
  });
  for (const line of run.status === 0 ? run.stdout.split("\n") : []) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    if (!match) continue;
    const name = basename(match[3]!.trim()).replace(/^-/u, "");
    darwin.set(Number(match[1]), { name, parent: Number(match[2]) });
  }
  return darwin;
}

export function runtimePid(start = process.ppid): number {
  let pid = start;
  for (let hop = 0; hop < 3; hop += 1) {
    const info = stat(pid);
    if (!info || !SHELLS.has(info.name) || info.parent <= 1) return pid;
    pid = info.parent;
  }
  return pid;
}

export function isLive(
  record: SessionRecord,
  now: number,
  staleMs = STALE_MS,
): boolean {
  return recordLive(record, now, alive(record.pid), staleMs);
}
