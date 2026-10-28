import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadavg } from "node:os";
import { git, gitText, runCommand, runCommandLogged } from "../exec.js";
import { isAncestor, touchedPaths, undelivered } from "../landed.js";
import type {
  DeliverConfig,
  GateConfig,
  GitContext,
  LeaseSpec,
  Reporter,
} from "../types.js";
import { gateLog, gateTree, runGate } from "./gate.js";
import {
  acquireHostLock,
  readHolder,
  removeHolder,
  writeHolder,
} from "./lock.js";
import { pushPins } from "./pins.js";
import { withUmask } from "../modes.js";
import { waitForLeases } from "./lease-wait.js";
import { replay } from "./replay.js";
import type { SessionGate } from "./store.js";
import type { SyncResult } from "./sync.js";

export interface DeliverOptions {
  readonly ctx: GitContext;
  readonly named: readonly string[];
  readonly deliver: DeliverConfig;
  readonly gate?: GateConfig;

  readonly tree: string;
  readonly links: readonly string[];
  readonly leases: readonly LeaseSpec[];
  readonly store: SessionGate;
  readonly duringPause?: boolean;
  readonly leasePollMs?: number;
  // Hold leases through follow-up installation so peers cannot observe a partially installed lockfile change.
  // The sync it ran, if any, goes into the receipt.
  readonly afterDeliver?: () => SyncResult | null;
  // Then the delivering desk's own sync, if any; it also goes into the receipt.
  readonly afterDeliverDesk?: () => SyncResult | null;
  // Called once delivered and after afterDeliver, with the leases this delivery took.
  readonly recordDelivery?: (delivery: Delivery) => void;
  // The outcome as data, once deliver returns (pmcp git deliver --json prints it).
  readonly onReceipt?: (receipt: DeliverReceipt) => void;
  readonly report: Reporter;
  // Filled in as the delivery runs; set by deliver itself.
  readonly track?: Track;
  // The 1-minute load average and the poll interval; tests replace them.
  readonly loadavg?: () => number;
  // Push submodule pins the delivered commits set before replaying them ([git.submodules] push).
  readonly pushPins?: boolean;
  readonly loadPollMs?: number;
  // [git] umask for every checkout write (scratch replay, gate tree); the gate tree's rewritten
  // tracked files also get their index mode back.
  readonly umask?: number;
  // Replay and gate, then stop: no pin, mainline or sync moves (pmcp git deliver --no-push).
  readonly noPush?: boolean;
  // Where gate output is kept, a directory per tip: [git.mainline.gate] log_dir, else the state
  // dir's gate-logs (the command passes it), else gate-logs beside the gate tree.
  readonly logDir?: string;
}

export interface DeliverReceipt {
  readonly ok: boolean;
  readonly code: number;
  // The upstream commit this delivery made, or null when nothing was pushed.
  readonly delivered: string | null;
  readonly upstream: string;
  readonly attempts: number;
  // The tip of the last replay onto the upstream, or null when nothing was replayed.
  readonly replayed: string | null;
  // The last gate run, and whether pmcp's command or the repository's pre-push hook ran it:
  // log is that run's full output, logs the tip's directory holding every run of it.
  readonly gate: {
    readonly exit: number;
    readonly log: string | null;
    readonly logs: string | null;
    readonly by: "command" | "pre-push";
  } | null;
  readonly leases: readonly string[];
  // The main checkout's sync after the delivery, or null when none ran.
  readonly sync: SyncResult | null;
  // The delivering desk's sync after the delivery, or null when none ran.
  readonly desk_sync: SyncResult | null;
  readonly reason?: string;
}

interface Track {
  attempts: number;
  gate: DeliverReceipt["gate"];
  replayed: string | null;
  delivered: string | null;
  leases: string[];
  sync: SyncResult | null;
  deskSync: SyncResult | null;
}

export interface Delivery {
  readonly leases: readonly string[];
  readonly subject: string;
  readonly commit: string;
}

function subject(cwd: string, sha: string): string {
  return gitText(cwd, ["log", "-1", "--format=%s", sha]);
}

function fetch(ctx: GitContext): boolean {
  return git(ctx.root, ["fetch", "-q", ctx.remote, ctx.mainline]).status === 0;
}

// The push carries PMCP_GIT_DELIVER=1 and push_env. When the repository's pre-push hook is the
// gate it also carries lock_env=1, since pmcp holds that lock, and its output is the gate log.
function push(options: DeliverOptions, tip: string, preHook: boolean) {
  const { ctx, report } = options;
  const lockEnv = options.gate?.lockEnv;
  const env = {
    ...options.deliver.pushEnv,
    ...(preHook && lockEnv ? { [lockEnv]: "1" } : {}),
    PMCP_GIT_DELIVER: "1",
  };
  const args = ["push", ctx.remote, `${tip}:refs/heads/${ctx.mainline}`];
  if (!preHook) return git(ctx.root, args, env);
  const { log, logs } = gateLog(logDir(options), tip, options.gate?.logKeep);
  report.info(`the pre-push hook gates ${tip.slice(0, 10)}; gate log: ${log}`);
  // Streamed as it comes, like a gate command, and kept whole in the log.
  const status = runCommandLogged(["git", ...args], ctx.root, log, env);
  if (options.track)
    options.track.gate = { exit: status, log, logs, by: "pre-push" };
  return { status, stdout: "", stderr: "" };
}

function logDir(options: DeliverOptions): string {
  return (
    options.gate?.logDir ??
    options.logDir ??
    join(dirname(gateTree(options.tree).tree), "gate-logs")
  );
}

// Hold one lock across replay, gate and push so competing deliveries cannot interleave.
function attempts(options: DeliverOptions): number {
  const { ctx, report } = options;
  const { lock, tree } = gateTree(options.tree);
  for (let attempt = 1; attempt <= options.deliver.attempts; attempt += 1) {
    if (options.track) options.track.attempts = attempt;
    if (!fetch(ctx)) {
      report.warn(`fetch from ${ctx.remote} failed`);
      return 2;
    }
    const commits = undelivered(ctx.root, ctx.upstream, options.named);
    if (commits.length === 0) {
      report.info(`nothing that ${ctx.upstream} lacks`);
      return 0;
    }
    const first = commits[0] ?? "";
    writeHolder(lock, {
      tip: first,
      subject: subject(ctx.root, first),
      checkout: ctx.root,
    });
    report.info(
      `attempt ${attempt}: replaying ${commits.length} commit(s) onto ${ctx.upstream}`,
    );
    const replayed = replay(ctx.root, ctx.upstream, commits);
    if ("error" in replayed) {
      report.warn(replayed.error);
      return 1;
    }
    if (options.track) options.track.replayed = replayed.tip;
    const preHook = options.deliver.gate === "pre-push";
    const command = preHook ? undefined : options.gate?.command;
    if (command !== undefined) {
      const run = runGate(
        ctx.mainRoot,
        tree,
        replayed.tip,
        command,
        options.links,
        report,
        options.gate?.lockEnv,
        logDir(options),
        options.umask !== undefined,
        options.gate?.logKeep,
      );
      if (options.track)
        options.track.gate = {
          exit: run.code,
          log: run.log,
          logs: run.logs,
          by: "command",
        };
      if (run.code !== 0) {
        report.warn("the gate failed; nothing was pushed");
        return 1;
      }
    }
    if (options.noPush) {
      report.info(
        `replayed ${replayed.tip.slice(0, 10)}; --no-push, so nothing was pushed`,
      );
      return 0;
    }
    const pushed = push(options, replayed.tip, preHook);
    if (pushed.status === 0) {
      if (options.track) options.track.delivered = replayed.tip;
      report.info(`delivered ${replayed.tip.slice(0, 10)} to ${ctx.upstream}`);
      return 0;
    }
    fetch(ctx);
    if (isAncestor(ctx.root, ctx.upstream, replayed.tip)) {
      // In pre-push mode a refused push is the gate's verdict; its output is in the log.
      if (preHook)
        report.warn(
          `the pre-push gate failed (exit ${pushed.status}); nothing was pushed; full gate log: ${options.track?.gate?.log}`,
        );
      else
        report.warn(
          `the push failed for a reason other than a newer ${ctx.upstream}:\n${pushed.stderr.trim()}`,
        );
      return 1;
    }
    report.info(`${ctx.upstream} moved while the gate ran; replaying again`);
  }
  report.warn(
    `${ctx.upstream} kept moving; gave up after ${options.deliver.attempts} attempts`,
  );
  return 1;
}

// Under the lock, so no other gate starts meanwhile and adds to the load; nothing is retried
// once the gate runs. Linux /proc/loadavg; os.loadavg() elsewhere.
function hostLoad(): number {
  try {
    return Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
  } catch {
    return loadavg()[0] ?? 0;
  }
}

function loadAllows(options: DeliverOptions): boolean {
  const max = options.gate?.maxLoad;
  if (max === undefined) return true;
  const read = options.loadavg ?? hostLoad;
  const wait = options.gate?.loadWaitSeconds ?? 1800;
  const poll = options.loadPollMs ?? 15_000;
  const deadline = Date.now() + wait * 1000;
  let load = read();
  if (load < max) return true;
  options.report.info(
    `waiting for load ${load.toFixed(2)} to fall below ${max}`,
  );
  while (Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, poll);
    load = read();
    if (load < max) return true;
  }
  options.report.warn(
    `load stayed at or above ${max} for ${wait}s (now ${load.toFixed(2)}); nothing ran`,
  );
  return false;
}

function pinsPushed(options: DeliverOptions): boolean {
  const { ctx } = options;
  const commits = undelivered(ctx.root, ctx.upstream, options.named);
  const tip = commits.at(-1);
  return (
    tip === undefined || pushPins(ctx.root, ctx.upstream, tip, options.report)
  );
}

function underLock(options: DeliverOptions): number {
  const { lock } = gateTree(options.tree);
  const wait = options.gate?.lockWaitSeconds ?? 5400;
  const lockEnv = options.gate?.lockEnv;
  if (lockEnv && process.env[lockEnv] === "1") {
    options.report.info(
      `the gate lock is held by the caller (${lockEnv}=1); not taking it again`,
    );
    return attempts(options);
  }
  const held = acquireHostLock(lock, wait, () => {
    const holder = readHolder(lock);
    const who =
      holder === null
        ? "another delivery"
        : `${holder.tip.slice(0, 10)} "${holder.subject}" (pid ${holder.pid})`;
    options.report.info(`waiting for the gate of ${who}`);
  });
  if (held === null) {
    options.report.warn(`the gate lock stayed held for ${wait}s`);
    return 1;
  }
  // Named from the moment the lock is held, so a queued tool sharing the lock can say whose
  // gate it waits for; each attempt then names the replayed tip.
  writeHolder(lock, {
    tip: gitText(options.ctx.root, ["rev-parse", "HEAD"]),
    subject: subject(options.ctx.root, "HEAD"),
    checkout: options.ctx.root,
  });
  try {
    if (!loadAllows(options)) return 1;
    if (options.pushPins && !options.noPush && !pinsPushed(options)) return 1;
    return attempts(options);
  } finally {
    removeHolder(lock);
    held.release();
  }
}

function blocked(options: DeliverOptions): string | null {
  const pause = options.store.pause.read();
  const pauseAllowed =
    options.deliver.duringPause === "allow" || options.duringPause === true;
  if (pause !== null && !pauseAllowed)
    return `the sessions are paused (${pause.reason}, since ${pause.since}); deliver after resume, or pass --during-pause if this delivery is the fix`;
  return waitForLeases(
    options.store,
    options.leases,
    options.deliver.leaseWaitSeconds,
    options.report,
    options.leasePollMs,
  );
}

export function deliver(options: DeliverOptions): number {
  const track: Track = {
    attempts: 0,
    gate: null,
    replayed: null,
    delivered: null,
    leases: [],
    sync: null,
    deskSync: null,
  };
  let reason: string | undefined;
  const report: Reporter = {
    info: (line) => options.report.info(line),
    warn: (line) => {
      reason = line;
      options.report.warn(line);
    },
  };
  const code = withUmask(options.umask, () =>
    deliverOnce({ ...options, report, track }),
  );
  options.onReceipt?.({
    ok: code === 0,
    code,
    delivered: track.delivered,
    upstream: options.ctx.upstream,
    attempts: track.attempts,
    replayed: track.replayed,
    gate: track.gate,
    leases: track.leases,
    sync: track.sync,
    desk_sync: track.deskSync,
    ...(code !== 0 && reason ? { reason } : {}),
  });
  return code;
}

// Keep leased paths protected through the push and follow-up installation.
function deliverOnce(options: DeliverOptions): number {
  const { ctx, report } = options;
  if (options.noPush && options.deliver.gate === "pre-push") {
    report.warn(
      '--no-push cannot gate with gate = "pre-push": the push is the gate; nothing ran',
    );
    return 2;
  }
  const refusal = blocked(options);
  if (refusal !== null) {
    report.warn(refusal);
    return 1;
  }
  if (!fetch(ctx)) {
    report.warn(`fetch from ${ctx.remote} failed`);
    return 2;
  }
  const commits = undelivered(ctx.root, ctx.upstream, options.named);
  const touched = touchedPaths(ctx.root, commits);
  // Nothing installs after a run that does not push, so it takes no lease.
  const leased = options.noPush
    ? []
    : options.leases.filter((spec) =>
        spec.paths.some((path) => touched.has(path)),
      );
  const last = commits.at(-1) ?? "HEAD";
  const lease = {
    pid: process.pid,
    subject: subject(ctx.root, last),
    cwd: ctx.root,
    since: new Date().toISOString(),
  };
  const taken: string[] = [];
  try {
    for (const spec of leased) {
      if (!options.store.leases.take(spec.name, lease)) {
        report.warn(`lease ${spec.name} is held by another session`);
        return 1;
      }
      taken.push(spec.name);
      options.track?.leases.push(spec.name);
      report.info(`took lease ${spec.name}`);
    }
    const code = underLock(options);
    if (code !== 0 || options.noPush) return code;
    const synced = options.afterDeliver?.() ?? null;
    if (options.track) options.track.sync = synced;
    const deskSynced = options.afterDeliverDesk?.() ?? null;
    if (options.track) options.track.deskSync = deskSynced;
    if (taken.length > 0)
      options.recordDelivery?.({
        leases: taken,
        subject: lease.subject,
        commit: gitText(ctx.root, ["rev-parse", "--short=10", ctx.upstream]),
      });
    if (options.deliver.notify !== undefined && commits.length > 0)
      runCommand(options.deliver.notify, ctx.root, {
        PMCP_DELIVERED: gitText(ctx.root, ["rev-parse", ctx.upstream]),
      });
    return 0;
  } finally {
    for (const name of taken) options.store.leases.release(name);
  }
}
