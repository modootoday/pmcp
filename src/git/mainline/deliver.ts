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
  readonly report: Reporter;
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
    if (
      command !== undefined &&
      runGate(
        ctx.mainRoot,
        tree,
        replayed.tip,
        command,
        options.links,
        report,
        options.gate?.lockEnv,
      ) !== 0
    ) {
      report.warn("the gate failed; nothing was pushed");
      return 1;
    }
    const pushed = git(
      ctx.root,
      ["push", ctx.remote, `${replayed.tip}:refs/heads/${ctx.mainline}`],
      {
        PMCP_GIT_DELIVER: "1",
      },
    );
    if (pushed.status === 0) {
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
  try {
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

// Keep leased paths protected through the push and follow-up installation.
export function deliver(options: DeliverOptions): number {
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
      report.info(`took lease ${spec.name}`);
    }
    const code = underLock(options);
    if (code !== 0) return code;
    options.afterDeliver?.();
    if (options.deliver.notify !== undefined && commits.length > 0)
      runCommand(options.deliver.notify, ctx.root, {
        PMCP_DELIVERED: gitText(ctx.root, ["rev-parse", ctx.upstream]),
      });
    return 0;
  } finally {
    for (const name of taken) options.store.leases.release(name);
  }
}
