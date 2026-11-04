import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";

import { acquireLease, type LeaseOutcome } from "./acquire.js";
import { BUSY_EXIT, DISABLE_ENV, type LeaseSettings } from "./config.js";
import { epoch, oneLine } from "./files.js";

export interface HeavyRun {
  readonly settings: LeaseSettings;
  readonly profile: string;
  readonly label?: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly say: (line: string) => void;
}

let scopeSeen: boolean | undefined;

function scopeAvailable(): boolean {
  scopeSeen ??=
    process.platform === "linux" &&
    spawnSync("systemd-run", ["--user", "--version"], { stdio: "ignore" })
      .status === 0;
  return scopeSeen;
}

// MemoryMax with swap off, so a runaway job is killed alone instead of paging the host down.
export function scoped(
  argv: readonly string[],
  memoryMax: string | undefined,
  say: (line: string) => void,
): readonly string[] {
  if (memoryMax === undefined) return argv;
  if (!scopeAvailable()) {
    say(
      `systemd-run --user is unavailable; running without MemoryMax=${memoryMax}`,
    );
    return argv;
  }
  return [
    "systemd-run",
    "--user",
    "--scope",
    "-q",
    "-p",
    `MemoryMax=${memoryMax}`,
    "-p",
    "MemorySwapMax=0",
    "--",
    ...argv,
  ];
}

const SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

function execute(
  argv: readonly string[],
  run: HeavyRun,
  extra: Readonly<Record<string, string>>,
  onTick?: () => void,
): Promise<number> {
  const [bin, ...rest] = argv;
  return new Promise((resolve) => {
    const child = spawn(bin ?? "true", rest, {
      cwd: run.cwd,
      env: { ...run.env, ...extra },
      stdio: "inherit",
    });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of SIGNALS) process.on(signal, forward);
    const timer = onTick ? setInterval(onTick, 1000) : undefined;
    const done = (code: number) => {
      if (timer) clearInterval(timer);
      for (const signal of SIGNALS) process.off(signal, forward);
      resolve(code);
    };
    child.on("error", (error) => {
      run.say(`${bin}: ${error.message}`);
      done(127);
    });
    child.on("exit", (code, signal) => {
      if (code !== null) return done(code);
      done(128 + ((signal && constants.signals[signal]) || 15));
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

export async function runHeavy(run: HeavyRun): Promise<number> {
  const label = oneLine(run.label || run.argv.join(" "));
  let outcome: LeaseOutcome;
  if (!run.settings.enabled) {
    run.say("lease disabled ([host.lease] enabled = false); running now");
    outcome = { kind: "disabled" };
  } else {
    outcome = acquireLease({ ...run, label });
  }
  const memoryMax = run.settings.profiles[run.profile]?.memoryMax;
  const argv = scoped(run.argv, memoryMax, run.say);
  if (outcome.kind === "busy") {
    run.say(
      `not run: host busy; gave up after ${outcome.waited}s waiting for the host lease held by ${outcome.holder}`,
    );
    run.say(
      `run it again later, or set ${DISABLE_ENV}=<reason> to run beside it`,
    );
    return BUSY_EXIT;
  }
  if (outcome.kind !== "held") return execute(argv, run, {});
  const started = epoch();
  let code = 1;
  try {
    code = await execute(argv, run, outcome.env, holdWarner(run, started));
  } finally {
    outcome.release(code, epoch() - started);
  }
  return code;
}
