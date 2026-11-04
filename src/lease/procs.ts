import { readFileSync, readdirSync } from "node:fs";

import { sleepSeconds } from "./host.js";

// Heavy processes outside the lease: two /proc samples, so CPU and IO are rates, and every
// descendant of a running leased job (and of this process) left out.

export interface OutsideProcess {
  readonly pid: number;
  readonly cpu: number;
  readonly ioMbps: number;
  readonly command: string;
}

interface Sample {
  readonly ppid: number;
  readonly ticks: number;
  readonly bytes: number;
}

const TICKS_PER_SECOND = 100;

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function sample(proc: string): Map<number, Sample> {
  const found = new Map<number, Sample>();
  let names: string[];
  try {
    names = readdirSync(proc);
  } catch {
    return found;
  }
  for (const name of names) {
    if (!/^\d+$/u.test(name)) continue;
    const stat = read(`${proc}/${name}/stat`);
    if (stat === null) continue;
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const io = read(`${proc}/${name}/io`) ?? "";
    const bytes = (key: string) =>
      Number(io.match(new RegExp(`^${key}: (\\d+)`, "mu"))?.[1] ?? 0);
    found.set(Number(name), {
      ppid: Number(fields[1]),
      ticks: Number(fields[11]) + Number(fields[12]),
      bytes: bytes("read_bytes") + bytes("write_bytes"),
    });
  }
  return found;
}

function under(
  pid: number,
  roots: ReadonlySet<number>,
  all: Map<number, Sample>,
) {
  for (let at = pid, hops = 0; at > 1 && hops < 64; hops += 1) {
    if (roots.has(at)) return true;
    at = all.get(at)?.ppid ?? 0;
  }
  return false;
}

export function outsideLease(options: {
  readonly holders: readonly number[];
  readonly interval?: number;
  readonly proc?: string;
  readonly limit?: number;
}): OutsideProcess[] {
  const proc = options.proc ?? "/proc";
  const interval = options.interval ?? 1;
  const before = sample(proc);
  if (before.size === 0) return [];
  sleepSeconds(interval);
  const after = sample(proc);
  const roots = new Set([process.pid]);
  for (const pid of options.holders) roots.add(pid);
  const found: OutsideProcess[] = [];
  for (const [pid, now] of after) {
    const then = before.get(pid);
    if (then === undefined || now.ppid === 2 || pid === 2) continue;
    if (under(pid, roots, after)) continue;
    const cpu = ((now.ticks - then.ticks) / TICKS_PER_SECOND / interval) * 100;
    const ioMbps = (now.bytes - then.bytes) / interval / 1e6;
    if (cpu < 20 && ioMbps < 5) continue;
    const command = (read(`${proc}/${pid}/cmdline`) ?? "")
      .split("\0")
      .join(" ")
      .trim()
      .slice(0, 100);
    found.push({ pid, cpu, ioMbps, command });
  }
  return found
    .sort((a, b) => b.cpu + b.ioMbps * 10 - (a.cpu + a.ioMbps * 10))
    .slice(0, options.limit ?? 5);
}
