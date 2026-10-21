import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { git, gitText, runCommand } from "../exec.js";
import { isAncestor, touchedPaths, undelivered } from "../landed.js";
import type {
  DeliverConfig,
  GateConfig,
  GitContext,
  LeaseSpec,
  Reporter,
} from "../types.js";
import { gateTree, runGate } from "./gate.js";
import {
  acquireHostLock,
  readHolder,
  removeHolder,
  writeHolder,
} from "./lock.js";
import { pushPins } from "./pins.js";
import { waitForLeases } from "./lease-wait.js";
import { replay } from "./replay.js";
import type { SessionGate } from "./store.js";

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
  readonly afterDeliver?: () => void;
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
}

export interface DeliverReceipt {
  readonly ok: boolean;
  readonly code: number;
  // The upstream commit this delivery made, or null when nothing was pushed.
  readonly delivered: string | null;
  readonly upstream: string;
  readonly attempts: number;
  readonly gate: { readonly exit: number; readonly log: string | null } | null;
  readonly leases: readonly string[];
  readonly reason?: string;
}

interface Track {
  attempts: number;
  gate: DeliverReceipt["gate"];
  delivered: string | null;
  leases: string[];
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
    const command = options.gate?.command;
    if (command !== undefined) {
      const run = runGate(
        ctx.mainRoot,
        tree,
        replayed.tip,
        command,
        options.links,
        report,
        options.gate?.lockEnv,
        options.gate?.logDir,
      );
      if (options.track) options.track.gate = { exit: run.code, log: run.log };
      if (run.code !== 0) {
        report.warn("the gate failed; nothing was pushed");
        return 1;
      }
    }
    const pushed = git(
      ctx.root,
      ["push", ctx.remote, `${replayed.tip}:refs/heads/${ctx.mainline}`],
      {
        PMCP_GIT_DELIVER: "1",
      },
    );
    if (pushed.status === 0) {
      if (options.track) options.track.delivered = replayed.tip;
      report.info(`delivered ${replayed.tip.slice(0, 10)} to ${ctx.upstream}`);
      return 0;
    }
    fetch(ctx);
    if (isAncestor(ctx.root, ctx.upstream, replayed.tip)) {
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
    if (options.pushPins && !pinsPushed(options)) return 1;
    return attempts(options);
  } finally {
    held.release();
    removeHolder(lock);
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
  const track: Track = { attempts: 0, gate: null, delivered: null, leases: [] };
  let reason: string | undefined;
  const report: Reporter = {
    info: (line) => options.report.info(line),
    warn: (line) => {
      reason = line;
      options.report.warn(line);
    },
  };
  const code = deliverOnce({ ...options, report, track });
  options.onReceipt?.({
    ok: code === 0,
    code,
    delivered: track.delivered,
    upstream: options.ctx.upstream,
    attempts: track.attempts,
    gate: track.gate,
    leases: track.leases,
    ...(code !== 0 && reason ? { reason } : {}),
  });
  return code;
}

// Keep leased paths protected through the push and follow-up installation.
function deliverOnce(options: DeliverOptions): number {
  const { ctx, report } = options;
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
  const leased = options.leases.filter((spec) =>
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
    if (code !== 0) return code;
    options.afterDeliver?.();
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
