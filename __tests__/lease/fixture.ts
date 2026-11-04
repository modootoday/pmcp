import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readLeaseSettings,
  type LeaseSettings,
} from "../../src/lease/config.js";

export const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

export interface Scratch {
  readonly base: string;
  readonly dir: string;
  readonly env: Record<string, string>;
}

// A lease directory of its own and a quiet host, so tests never queue behind real work.
export function scratch(): Scratch {
  const base = mkdtempSync(join(tmpdir(), "pmcp-lease-"));
  const dir = join(base, "lease");
  writeFileSync(join(base, "loadavg"), "0.10 0.20 0.30 1/100 42\n");
  writeFileSync(
    join(base, "pressure"),
    "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !key.includes("HEAVY")) env[key] = value;
  env["PMCP_HEAVY_LOADAVG_FILE"] = join(base, "loadavg");
  env["PMCP_HEAVY_PRESSURE_FILE"] = join(base, "pressure");
  return { base, dir, env };
}

export function settings(
  dir: string,
  lease: Record<string, unknown> = {},
): LeaseSettings {
  return readLeaseSettings("pmcp.toml", "/", {
    lease: {
      dir,
      max_load: 1000,
      max_io: 1000,
      heartbeat: 1,
      poll: 1,
      ...lease,
    },
  });
}

export function project(base: string, toml: string): string {
  const cwd = join(base, "project");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "pmcp.toml"), toml);
  return cwd;
}

export function leaseToml(dir: string, extra = ""): string {
  return `[host.lease]\ndir = "${dir}"\nmax_load = 1000\nmax_io = 1000\nheartbeat = 1\npoll = 1\n${extra}`;
}

export function pmcp(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): ChildProcess {
  return spawn("bun", [CLI, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function pmcpSync(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
) {
  return spawnSync("bun", [CLI, ...args], { cwd, env, encoding: "utf8" });
}

export function finished(
  child: ChildProcess,
): Promise<{ code: number; stderr: string }> {
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  return new Promise((resolve) =>
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr })),
  );
}

// Holds the lock the way a shell wrapper does: flock on the file, recorded as the holder.
export function shellHolder(dir: string, seconds: number): ChildProcess {
  mkdirSync(dir, { recursive: true });
  const child = spawn(
    "flock",
    [join(dir, "heavy.lock"), "sleep", String(seconds)],
    {
      stdio: "ignore",
    },
  );
  writeFileSync(
    join(dir, "heavy.holder"),
    `pid=${child.pid}\nsince=${Math.floor(Date.now() / 1000)}\nstarted=2026-11-04T00:00:00Z\ncwd=/somewhere\nlabel=shell job\n`,
  );
  return child;
}

export function until(check: () => boolean, ms = 5000): void {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
