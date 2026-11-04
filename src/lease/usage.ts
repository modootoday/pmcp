import {
  appendFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";

// One usage record per pmcp heavy run, so weights can later be learned from what commands
// really cost. Records hold a command's signature, never its argument values or env.

export interface Usage {
  readonly at: string;
  readonly signature: string;
  readonly dir: string;
  readonly lane: string;
  readonly weight: number;
  readonly start: "queue" | "grace" | "bypass" | "none";
  readonly outcome: "ran" | "timeout" | "cancelled";
  readonly exit: number;
  readonly wall_s: number;
  readonly user_s: number;
  readonly sys_s: number;
  readonly max_rss_kb: number;
  readonly read_bytes: number;
  readonly write_bytes: number;
  // Where the numbers come from: the job's cgroup, or /proc sampled once a second.
  readonly source: "cgroup" | "proc" | "none";
}

// Lower-case words only: a path, a flag, a version, a name=value or a quoted value ends it.
const WORD = /^[a-z][a-z0-9:_-]{0,39}$/u;

// The program and the subcommand words before the first option, path or value.
export function signature(argv: readonly string[]): string {
  const [program = "", ...rest] = argv;
  const words = [program.slice(program.lastIndexOf("/") + 1)];
  for (const word of rest) {
    if (!WORD.test(word)) break;
    words.push(word);
  }
  return words.join(" ");
}

export function packageDir(cwd: string, root: string): string {
  const path = relative(root, cwd);
  return path === "" ? "." : path.startsWith("..") ? "(outside)" : path;
}

export function appendUsage(file: string, usage: Usage, cap: number): void {
  try {
    if (statSync(file).size >= cap) renameSync(file, `${file}.1`);
  } catch {
    // No file yet.
  }
  try {
    appendFileSync(file, `${JSON.stringify(usage)}\n`);
  } catch {
    // A record for later tuning; a full disk must not fail the command.
  }
}

export function readUsage(file: string): Usage[] {
  const found: Usage[] = [];
  for (const path of [`${file}.1`, file]) {
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        found.push(JSON.parse(line) as Usage);
      } catch {
        // A torn line from a full disk is skipped.
      }
    }
  }
  return found;
}

const METRICS = [
  "wall_s",
  "user_s",
  "sys_s",
  "max_rss_kb",
  "read_bytes",
  "write_bytes",
] as const;

export interface UsageStat {
  readonly signature: string;
  readonly samples: number;
  readonly failed: number;
  readonly timeouts: number;
  readonly p50: Record<(typeof METRICS)[number], number>;
  readonly p90: Record<(typeof METRICS)[number], number>;
}

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0
  );
}

export function usageStats(records: readonly Usage[]): UsageStat[] {
  const groups = new Map<string, Usage[]>();
  for (const record of records) {
    const key = `${record.signature} @ ${record.dir}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const ran = list.filter((record) => record.outcome === "ran");
      const pick = (share: number) =>
        Object.fromEntries(
          METRICS.map((metric) => [
            metric,
            percentile(
              ran.map((record) => record[metric]),
              share,
            ),
          ]),
        ) as UsageStat["p50"];
      return {
        signature: key,
        samples: ran.length,
        failed: ran.filter((record) => record.exit !== 0).length,
        timeouts: list.length - ran.length,
        p50: pick(0.5),
        p90: pick(0.9),
      };
    })
    .sort(
      (a, b) => b.samples - a.samples || a.signature.localeCompare(b.signature),
    );
}

// What the job used, sampled from /proc: CPU exactly, from this process's reaped-children
// times; peak RSS and IO bytes from its live process tree once a second (short-lived
// processes are partly missed), or from its cgroup when it has one.
export class Sampler {
  private readonly ticks = 100;
  private readonly before: { user: number; sys: number };
  private peakRss = 0;
  private readonly io = new Map<number, { read: number; write: number }>();
  private cgroup: string | null = null;
  private cgroupIo = { read: 0, write: 0 };
  private cgroupPeak = 0;

  constructor(private readonly proc = "/proc") {
    this.before = this.children();
  }

  private children(): { user: number; sys: number } {
    try {
      const stat = readFileSync(`${this.proc}/self/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return { user: Number(fields[13]), sys: Number(fields[14]) };
    } catch {
      return { user: 0, sys: 0 };
    }
  }

  useCgroup(dir: string): void {
    this.cgroup = dir;
  }

  sample(root: number | undefined): void {
    if (this.cgroup) this.sampleCgroup(this.cgroup);
    if (root === undefined) return;
    const parents = new Map<number, number>();
    let names: string[] = [];
    try {
      names = readdirSync(this.proc).filter((name) => /^\d+$/u.test(name));
    } catch {
      return;
    }
    for (const name of names) {
      try {
        const stat = readFileSync(`${this.proc}/${name}/stat`, "utf8");
        parents.set(
          Number(name),
          Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]),
        );
      } catch {
        // Gone meanwhile.
      }
    }
    const inTree = (pid: number) => {
      for (let at = pid, hops = 0; at > 1 && hops < 64; hops += 1) {
        if (at === root) return true;
        at = parents.get(at) ?? 0;
      }
      return false;
    };
    let rss = 0;
    for (const pid of parents.keys()) {
      if (!inTree(pid)) continue;
      try {
        const status = readFileSync(`${this.proc}/${pid}/status`, "utf8");
        rss += Number(status.match(/^VmRSS:\s+(\d+)/mu)?.[1] ?? 0);
        const io = readFileSync(`${this.proc}/${pid}/io`, "utf8");
        const value = (key: string) =>
          Number(io.match(new RegExp(`^${key}: (\\d+)`, "mu"))?.[1] ?? 0);
        this.io.set(pid, {
          read: value("read_bytes"),
          write: value("write_bytes"),
        });
      } catch {
        // Gone meanwhile, or not ours to read.
      }
    }
    this.peakRss = Math.max(this.peakRss, rss);
  }

  private sampleCgroup(dir: string): void {
    try {
      const peak = Number(
        readFileSync(join(dir, "memory.peak"), "utf8").trim(),
      );
      if (peak > 0)
        this.cgroupPeak = Math.max(this.cgroupPeak, Math.round(peak / 1024));
    } catch {
      // No memory accounting there.
    }
    try {
      let read = 0;
      let write = 0;
      for (const line of readFileSync(join(dir, "io.stat"), "utf8").split(
        "\n",
      )) {
        read += Number(line.match(/rbytes=(\d+)/u)?.[1] ?? 0);
        write += Number(line.match(/wbytes=(\d+)/u)?.[1] ?? 0);
      }
      this.cgroupIo = { read, write };
    } catch {
      // No io accounting there.
    }
  }

  finish(): Pick<
    Usage,
    "user_s" | "sys_s" | "max_rss_kb" | "read_bytes" | "write_bytes" | "source"
  > {
    const after = this.children();
    const cpu = {
      user_s: Math.max(0, after.user - this.before.user) / this.ticks,
      sys_s: Math.max(0, after.sys - this.before.sys) / this.ticks,
    };
    if (
      this.cgroup &&
      (this.cgroupPeak > 0 || this.cgroupIo.read + this.cgroupIo.write > 0)
    )
      return {
        ...cpu,
        max_rss_kb: this.cgroupPeak || this.peakRss,
        read_bytes: this.cgroupIo.read,
        write_bytes: this.cgroupIo.write,
        source: "cgroup",
      };
    let read = 0;
    let write = 0;
    for (const value of this.io.values()) {
      read += value.read;
      write += value.write;
    }
    return {
      ...cpu,
      max_rss_kb: this.peakRss,
      read_bytes: read,
      write_bytes: write,
      source: "proc",
    };
  }
}
