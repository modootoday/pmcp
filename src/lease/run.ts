import { spawn } from "node:child_process";
import { constants } from "node:os";

import { BUS_FAILURE, scoped } from "./scope.js";

import {
  acquireLease,
  profileLane,
  skipSource,
  type LeaseOutcome,
} from "./acquire.js";
import { BUSY_EXIT, DISABLE_ENV, type LeaseSettings } from "./config.js";
import { epoch, leasePaths, oneLine, type LeaseLane } from "./files.js";
import {
  appendUsage,
  packageDir,
  Sampler,
  signature,
  type Usage,
} from "./usage.js";

export interface HeavyRun {
  readonly settings: LeaseSettings;
  readonly profile: string;
  readonly label?: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly say: (line: string) => void;
  readonly lane?: LeaseLane;
  readonly weight?: number;
  readonly now?: string;
  // The project root, so usage records name the package directory relative to it.
  readonly root?: string;
  // The queue id: a submitted ticket's.
  readonly id?: string;
  // Called with the run's usage record once it is written (a submitted ticket keeps it).
  readonly onUsage?: (usage: Usage) => void;
  // Whether the caller is the operator, for the operator skip reason.
  readonly operator?: () => boolean;
  // Where the job's stdout and stderr are kept; echo false keeps them off the terminal.
  readonly output?: { write(chunk: Buffer | string): void };
  readonly echo?: boolean;
}

// Output still buffered when the job exits is read for at most this long; a background child
// holding the pipes open must not hold the run.
const DRAIN_MS = 2000;

// A skip reason pmcp does not allow is a usage error: the command line or setup is wrong.
const INVALID_EXIT = 2;

function prefixed(argv: readonly string[], prefix: readonly string[]) {
  const name = (word = "") => word.slice(word.lastIndexOf("/") + 1);
  return (
    argv.length >= prefix.length &&
    prefix.every((word, at) => (at === 0 ? name(argv[0]) : argv[at]) === word)
  );
}

// --lane and --weight win; the gate and hook profiles name their lane; then the first
// [host.lease] commands entry whose argv prefix matches; then the lane's default weight.
export function laneFor(run: HeavyRun): { lane: LeaseLane; weight: number } {
  const command = run.settings.commands.find((entry) =>
    prefixed(run.argv, entry.argv),
  );
  const fromProfile = run.profile === "gate" || run.profile === "hook";
  const lane =
    run.lane ??
    (fromProfile ? profileLane(run.profile) : (command?.lane ?? "interactive"));
  const tiny = run.settings.tiny.some((prefix) => prefixed(run.argv, prefix));
  const weight =
    run.weight ?? command?.weight ?? (tiny ? 0 : run.settings.weights[lane]);
  return { lane, weight };
}

const SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

interface Watch {
  // Once a second while the job runs, with the job's pid.
  readonly tick: (pid: number | undefined) => void;
  readonly started?: () => Promise<void>;
  // Keeps the start of stderr, passed through as it arrives, to tell a scope failure apart.
  readonly stderrHead?: (text: string) => void;
}

const HEAD = 2048;

function execute(
  argv: readonly string[],
  run: HeavyRun,
  extra: Readonly<Record<string, string>>,
  watch: Watch,
): Promise<number> {
  const [bin, ...rest] = argv;
  const kept = run.output;
  const echo = run.echo !== false;
  return new Promise((resolve) => {
    const child = spawn(bin ?? "true", rest, {
      cwd: run.cwd,
      env: { ...run.env, ...extra },
      stdio: [
        "inherit",
        kept ? "pipe" : "inherit",
        kept || watch.stderrHead ? "pipe" : "inherit",
      ],
    });
    let head = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (echo) process.stdout.write(chunk);
      kept?.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (echo) process.stderr.write(chunk);
      kept?.write(chunk);
      if (head.length >= HEAD) return;
      head += chunk.toString("utf8");
      watch.stderrHead?.(head.slice(0, HEAD));
    });
    void watch.started?.();
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of SIGNALS) process.on(signal, forward);
    const timer = setInterval(() => watch.tick(child.pid), 1000);
    let finished = false;
    const done = (code: number) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      for (const signal of SIGNALS) process.off(signal, forward);
      resolve(code);
    };
    child.on("error", (error) => {
      run.say(`${bin}: ${error.message}`);
      done(127);
    });
    child.on("exit", (code, signal) => {
      const exit = code ?? 128 + ((signal && constants.signals[signal]) || 15);
      if (!child.stdout && !child.stderr) return done(exit);
      const drained = setTimeout(() => done(exit), DRAIN_MS);
      child.on("close", () => {
        clearTimeout(drained);
        done(exit);
      });
    });
  });
}

// The holder says once when it passes hold_warn, so the queue behind it is not a mystery.
function holdWarner(run: HeavyRun, since: number): () => void {
  let warned = false;
  return () => {
    const held = epoch() - since;
    if (warned || held < run.settings.holdWarn) return;
    warned = true;
    run.say(
      `holding the host lease for ${held}s (hold_warn ${run.settings.holdWarn}s); others may be waiting`,
    );
  };
}

const BECAUSE = {
  queue: "the jobs ahead kept the budget",
  parked: "this session already had a job queued in the lane (per_session)",
  host: "the host stayed at hard_factor x a limit or more",
  legacy: "a shell wrapper kept the whole lease",
};

function busyReason(busy: Extract<LeaseOutcome, { kind: "busy" }>): string {
  return `gave up after ${busy.waited}s in the ${busy.lane} lane (position ${busy.position}): ${BECAUSE[busy.reason]}; ${busy.host}`;
}

function record(
  run: HeavyRun,
  fields: Omit<Usage, "at" | "signature" | "dir">,
): void {
  const usage: Usage = {
    at: new Date().toISOString(),
    signature: signature(run.argv),
    dir: packageDir(run.cwd, run.root ?? run.cwd),
    ...fields,
  };
  appendUsage(leasePaths(run.settings.dir).usage, usage, run.settings.usageCap);
  run.onUsage?.(usage);
}

// A record names the variable that carried a skip, whether the skip was honoured or refused.
function skipFields(
  run: HeavyRun,
  outcome: LeaseOutcome,
): Pick<Usage, "skip" | "skip_refused" | "skip_invalid" | "skip_env"> {
  if (outcome.kind === "invalid")
    return { skip_invalid: outcome.reason, skip_env: outcome.variable };
  if (outcome.kind === "skipped")
    return {
      skip: outcome.reason,
      ...(outcome.variable ? { skip_env: outcome.variable } : {}),
    };
  if (outcome.kind === "disabled" || outcome.kind === "reentrant") return {};
  const refused = skipSource(run.settings, run.env);
  return refused
    ? { skip_refused: refused.reason, skip_env: refused.variable }
    : {};
}

// A job cancelled while it queued ends like one stopped by SIGINT.
const CANCELLED_EXIT = 130;

const NOTHING = {
  wall_s: 0,
  user_s: 0,
  sys_s: 0,
  max_rss_kb: 0,
  read_bytes: 0,
  write_bytes: 0,
  source: "none",
} as const;

export async function runHeavy(run: HeavyRun): Promise<number> {
  const label = oneLine(run.label || run.argv.join(" "));
  const { lane, weight } = laneFor(run);
  let outcome: LeaseOutcome;
  if (!run.settings.enabled) {
    run.say("lease disabled ([host.lease] enabled = false); running now");
    outcome = { kind: "disabled" };
  } else {
    outcome = acquireLease({ ...run, label, lane, weight });
  }
  if (outcome.kind === "invalid") {
    record(run, {
      ...NOTHING,
      lane,
      weight,
      start: "none",
      outcome: "invalid",
      exit: INVALID_EXIT,
      ...skipFields(run, outcome),
    });
    return INVALID_EXIT;
  }
  if (outcome.kind === "cancelled") {
    record(run, {
      ...NOTHING,
      lane,
      weight,
      start: "none",
      outcome: "cancelled",
      exit: CANCELLED_EXIT,
      ...skipFields(run, outcome),
    });
    return CANCELLED_EXIT;
  }
  if (outcome.kind === "busy") {
    run.say(`not run: host busy; ${busyReason(outcome)}`);
    if (outcome.lane === "bulk" && outcome.reason === "queue")
      run.say(
        "a bulk job waits behind every gate, hook and interactive job; this one reached its max_wait",
      );
    run.say(
      `run it again later, or set ${DISABLE_ENV}=<reason> to run beside it`,
    );
    record(run, {
      ...NOTHING,
      lane,
      weight,
      start: "none",
      outcome: "timeout",
      exit: BUSY_EXIT,
      ...skipFields(run, outcome),
    });
    return BUSY_EXIT;
  }
  const memoryMax = run.settings.profiles[run.profile]?.memoryMax;
  const held = outcome.kind === "held" ? outcome : null;
  const sampler = new Sampler();
  const { argv, started, unscoped } = scoped(
    run.argv,
    run.settings,
    held ? lane : null,
    memoryMax,
    run.say,
    (dir) => sampler.useCgroup(dir),
    undefined,
    undefined,
    run.env,
  );
  const warn = held ? holdWarner(run, epoch()) : () => {};
  const tick = (pid: number | undefined) => {
    warn();
    sampler.sample(pid);
  };
  const begun = Date.now();
  let code = 1;
  let head = "";
  try {
    code = await execute(argv, run, held?.env ?? {}, {
      tick,
      ...(started ? { started } : {}),
      ...(unscoped ? { stderrHead: (text: string) => (head = text) } : {}),
    });
    // The scope, not the job, failed: the user manager went away after the check.
    if (code !== 0 && unscoped && BUS_FAILURE.test(head.split("\n")[0] ?? "")) {
      run.say(
        "systemd-run could not reach the user manager; running the command again without the scope",
      );
      code = await execute(unscoped, run, held?.env ?? {}, { tick });
    }
  } finally {
    const wall = Math.round((Date.now() - begun) / 100) / 10;
    held?.release(code, Math.round(wall));
    if (outcome.kind !== "disabled")
      record(run, {
        ...sampler.finish(),
        wall_s: wall,
        lane,
        weight,
        start: held ? held.start : "none",
        outcome: "ran",
        exit: code,
        ...skipFields(run, outcome),
      });
  }
  return code;
}
