import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ArgumentError,
  EXIT,
  one,
  type CommandContext,
} from "../../../cli/command.js";
import { ConfigError, findConfig } from "../../../config.js";
import { leaseSettingsFor, type LeaseSettings } from "../../../lease/config.js";
import { runHeavy } from "../../../lease/run.js";
import { userManager } from "../../../lease/scope.js";
import {
  inScope,
  jobArgv,
  readJson,
  RESULT,
  selfArgv,
  THREADS,
  type Job,
} from "../jobs.js";

export function leaseOf(context: CommandContext): LeaseSettings {
  try {
    return leaseSettingsFor(context.cwd, one(context.args, "config"));
  } catch (error) {
    if (error instanceof ConfigError) throw new ArgumentError(error.message);
    throw error;
  }
}

// io.cost is a cgroup v2 controller of the Linux block layer; elsewhere there is nothing to tune.
export function linuxOnly(
  context: CommandContext,
  verb: string,
): number | null {
  if (process.platform === "linux") return null;
  context.ui.error(
    `pmcp host io ${verb} needs Linux with cgroup v2 io.cost; this is ${process.platform}`,
  );
  return EXIT.missingOptional;
}

export function seconds(context: CommandContext, fallback: number): number {
  const text = one(context.args, "seconds");
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 600)
    throw new ArgumentError("--seconds is a whole number from 1 to 600");
  return value;
}

export function probeDir(base: string): string {
  return join(
    base,
    `.pmcp-io-probe-${process.pid}-${randomBytes(4).toString("hex")}`,
  );
}

export interface Leased<T> {
  readonly code: number;
  readonly result: T | null;
}

// Waits its turn in the bulk lane with the whole budget, so nothing leased runs beside the
// probe; the job's directory is removed however the run ends.
export async function underLease<T>(
  context: CommandContext,
  lease: LeaseSettings,
  options: {
    readonly verb: string;
    readonly job: Job;
    readonly scoped: boolean;
  },
): Promise<Leased<T>> {
  const say = (line: string) => context.ui.info(line);
  const dir = options.job.dir;
  const remove = () => rmSync(dir, { recursive: true, force: true });
  process.once("exit", remove);
  let argv: readonly string[] = jobArgv(selfArgv(), options.verb, options.job);
  if (options.scoped) {
    const reason = userManager().unreachable(context.env);
    if (reason === null)
      argv = inScope(argv, `pmcp-io-probe-${process.pid}-${Date.now()}`);
    else
      say(
        `no systemd user scope (${reason}); probing in this process's cgroup, where an io.max would cap the numbers`,
      );
  }
  const config = one(context.args, "config") ?? findConfig(context.cwd);
  try {
    const code = await runHeavy({
      settings: lease,
      profile: "default",
      label: `pmcp host io ${options.verb}`,
      lane: "bulk",
      weight: lease.budget,
      placed: true,
      root: config ? dirname(config) : context.cwd,
      argv,
      cwd: context.cwd,
      env: { ...context.env, UV_THREADPOOL_SIZE: THREADS },
      say: (line) => process.stderr.write(`pmcp host io: ${line}\n`),
    });
    if (code !== 0) return { code, result: null };
    return { code, result: readJson<T>(join(dir, RESULT)) };
  } finally {
    remove();
    process.off("exit", remove);
  }
}
