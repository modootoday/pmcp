import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { applyIo, cgroupHost } from "../../lease/iocontrol.js";
import {
  DEPTH,
  makeFile,
  PATTERNS,
  probeAll,
  runPattern,
  type Rate,
} from "./probe.js";
import { ioGaps } from "./sysfs.js";

// The probe runs as a child of the leased pmcp, its job passed on the command line, so the IO
// happens in a scope of its own and nothing exists on disk before the lease is held.

// A slice beside app.slice, so no lane's io.max caps the probe.
export const PROBE_SLICE = "pmcp-io.slice";

export type Job =
  | {
      readonly kind: "measure";
      readonly dir: string;
      readonly sizeMb: number;
      readonly seconds: number;
    }
  | {
      readonly kind: "compare";
      readonly dir: string;
      readonly sizeMb: number;
      readonly seconds: number;
      readonly self: readonly string[];
    }
  | {
      readonly kind: "reader";
      readonly dir: string;
      readonly weight: number;
      readonly startAt: number;
      readonly seconds: number;
    };

// Where each job leaves its result inside its directory.
export const RESULT = "result.json";

export interface ReaderResult {
  readonly weight: number;
  readonly cgroup: string;
  // Ancestors whose subtree_control lacks io; any one makes the comparison meaningless.
  readonly gaps: readonly string[];
  readonly weightSet: boolean;
  readonly rate: Rate | null;
}

export interface CompareResult {
  readonly valid: boolean;
  readonly readers: readonly ReaderResult[];
  // IOPS at weight 100 over IOPS at weight 25; 4 when io.weight fully applies.
  readonly ratio: number | null;
  readonly problem?: string;
}

export const THREADS = String(DEPTH);

export function selfArgv(): string[] {
  return [process.execPath, ...process.execArgv, process.argv[1] ?? ""];
}

export function jobArgv(
  self: readonly string[],
  verb: string,
  job: Job,
): string[] {
  return [...self, "host", "io", verb, "--probe", JSON.stringify(job)];
}

export function inScope(
  argv: readonly string[],
  unit: string,
): readonly string[] {
  return [
    "systemd-run",
    "--user",
    "--scope",
    "-q",
    `--slice=${PROBE_SLICE}`,
    `--unit=${unit}`,
    "--",
    ...argv,
  ];
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function ownCgroup(): string {
  const line = readFileSync("/proc/self/cgroup", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("0::"));
  return line?.slice(3).trim() ?? "";
}

async function reader(job: Extract<Job, { kind: "reader" }>): Promise<void> {
  const host = cgroupHost();
  const scope = ownCgroup();
  const applied = applyIo(host, scope, job.weight, undefined);
  let weightSet = false;
  try {
    const text = readFileSync(join(host.root, scope, "io.weight"), "utf8");
    weightSet = text.includes(`default ${job.weight}`);
  } catch {
    weightSet = false;
  }
  const gaps = ioGaps(host.root, scope);
  const base = { weight: job.weight, cgroup: scope, gaps, weightSet };
  const out = join(job.dir, RESULT);
  if (gaps.length > 0 || !applied.weight || !weightSet) {
    writeJson(out, { ...base, rate: null });
    return;
  }
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, job.startAt - Date.now())),
  );
  const rate = await runPattern(
    join(job.dir, "probe.bin"),
    job.seconds,
    PATTERNS["rrand_4k_qd16"]!,
  );
  writeJson(out, { ...base, rate });
}

function waitFor(argv: readonly string[]): Promise<number> {
  const [bin, ...rest] = argv;
  return new Promise((resolve) => {
    const child = spawn(bin!, rest, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, UV_THREADPOOL_SIZE: THREADS },
    });
    child.on("error", () => resolve(127));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export const WEIGHTS = [25, 100] as const;

async function compare(job: Extract<Job, { kind: "compare" }>): Promise<void> {
  const dirs = WEIGHTS.map((weight) => join(job.dir, `w${weight}`));
  for (const dir of dirs) {
    mkdirSync(dir, { mode: 0o700 });
    makeFile(join(dir, "probe.bin"), job.sizeMb);
  }
  const startAt = Date.now() + 3000;
  const codes = await Promise.all(
    WEIGHTS.map((weight, at) => {
      const unit = `pmcp-io-check-w${weight}-${process.pid}-${Date.now()}`;
      const reading: Job = {
        kind: "reader",
        dir: dirs[at]!,
        weight,
        startAt,
        seconds: job.seconds,
      };
      return waitFor(inScope(jobArgv(job.self, "doctor", reading), unit));
    }),
  );
  writeJson(join(job.dir, RESULT), compareOf(dirs, codes));
}

function compareOf(
  dirs: readonly string[],
  codes: readonly number[],
): CompareResult {
  if (codes.some((code) => code !== 0))
    return {
      valid: false,
      readers: [],
      ratio: null,
      problem: `a test scope exited ${codes.join(" and ")}`,
    };
  return judgeCompare(
    dirs.map((dir) => readJson<ReaderResult>(join(dir, RESULT))),
  );
}

export function judgeCompare(readers: readonly ReaderResult[]): CompareResult {
  const gaps = [...new Set(readers.flatMap((entry) => entry.gaps))];
  if (gaps.length > 0)
    return {
      valid: false,
      readers,
      ratio: null,
      problem: `io is not enabled in cgroup.subtree_control of ${gaps.join(", ")}`,
    };
  const unset = readers.filter((entry) => !entry.weightSet);
  if (unset.length > 0)
    return {
      valid: false,
      readers,
      ratio: null,
      problem: `io.weight could not be written in ${unset.map((entry) => entry.cgroup).join(", ")}`,
    };
  const low = readers.find((entry) => entry.weight === 25)?.rate?.iops ?? 0;
  const high = readers.find((entry) => entry.weight === 100)?.rate?.iops ?? 0;
  return {
    valid: true,
    readers,
    ratio: Math.round((high / Math.max(low, 1)) * 100) / 100,
  };
}

// The leased parent made nothing; the job makes its own directory, which the parent removes.
export async function runJob(text: string): Promise<number> {
  const job = JSON.parse(text) as Job;
  if (job.kind !== "reader") mkdirSync(job.dir, { mode: 0o700 });
  if (job.kind === "measure") {
    process.stderr.write(
      `pmcp host io: probing ${job.dir} (${job.sizeMb} MiB, ${job.seconds}s per pattern)\n`,
    );
    const probes = await probeAll(
      join(job.dir, "probe.bin"),
      job.sizeMb,
      job.seconds,
    );
    writeJson(join(job.dir, RESULT), probes);
  } else if (job.kind === "reader") await reader(job);
  else await compare(job);
  return 0;
}
