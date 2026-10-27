import { existsSync } from "node:fs";
import { join } from "node:path";

import { git, gitText } from "../exec.js";
import { installIfStale, installSpec } from "../install.js";
import { cherry } from "../landed.js";
import {
  reportModes,
  restoreModes,
  restoreSubmoduleModes,
  withUmask,
} from "../modes.js";
import { followPins } from "../submodules.js";
import type { GitContext, MainlineSyncConfig, Reporter } from "../types.js";
import { resetKeepingIdenticalFiles } from "./identical-files.js";

export interface MainlineSyncOptions {
  readonly ctx: GitContext;
  readonly sync: MainlineSyncConfig;
  readonly followSubmodules: boolean;
  readonly sharedSubmodules?: readonly string[];

  readonly stateDir: string;
  readonly report: Reporter;
  // [git] umask: the move and the install run under it, and rewritten tracked files get their
  // index mode back.
  readonly umask?: number;
}

const IN_PROGRESS = [
  "index.lock",
  "MERGE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
];

function refusal(ctx: GitContext): string | null {
  if (ctx.linked)
    return "this is a linked worktree; sync moves only the main checkout";
  const branch = gitText(ctx.root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (branch !== ctx.mainline)
    return `the main checkout is on ${branch || "a detached HEAD"}, not ${ctx.mainline}`;
  for (const marker of IN_PROGRESS) {
    if (existsSync(join(ctx.gitDir, marker)))
      return `${marker} is present; another git command is running or unfinished`;
  }
  return null;
}

function install(options: MainlineSyncOptions): number {
  const { ctx, sync, report } = options;
  const spec = installSpec(sync, options.stateDir);
  if (spec === undefined) return 0;
  const status = installIfStale(ctx.root, spec, report);
  if (status === null || status === 0) return 0;
  return 1;
}

// Refuse unlanded commits so synchronization cannot discard another session's work.
export function syncMainline(options: MainlineSyncOptions): number {
  return withUmask(options.umask, () => syncOnce(options));
}

// One sync as data: the main checkout's HEAD before and after, the exit code, and the last
// warning when there was one.
export interface SyncResult {
  readonly from: string;
  readonly to: string;
  readonly code: number;
  readonly reason?: string;
}

export function syncMainlineResult(options: MainlineSyncOptions): SyncResult {
  let reason: string | undefined;
  const report: Reporter = {
    info: (line) => options.report.info(line),
    warn: (line) => {
      reason = line;
      options.report.warn(line);
    },
  };
  const head = () => gitText(options.ctx.root, ["rev-parse", "HEAD"]);
  const from = head();
  const code = syncMainline({ ...options, report });
  return { from, to: head(), code, ...(reason ? { reason } : {}) };
}

function syncOnce(options: MainlineSyncOptions): number {
  const { ctx, sync, report } = options;
  const blocked = refusal(ctx);
  if (blocked !== null) {
    report.warn(blocked);
    return 2;
  }
  if (git(ctx.root, ["fetch", "-q", ctx.remote, ctx.mainline]).status !== 0) {
    report.warn(`fetch from ${ctx.remote} failed`);
    return 2;
  }
  const { carried, missing } = cherry(ctx.root, ctx.upstream);
  if (missing.length > 0) {
    const listed = missing.map((line) => `  ${line}`).join("\n");
    report.warn(
      `${ctx.mainline} carries ${missing.length} commit(s) ${ctx.upstream} lacks; deliver or move them first:\n${listed}`,
    );
    return sync.refuseWithUnlanded ? 1 : 0;
  }
  const head = gitText(ctx.root, ["rev-parse", "HEAD"]);
  const target = gitText(ctx.root, ["rev-parse", ctx.upstream]);
  if (head === target) {
    report.info(`${ctx.mainline} already equals ${ctx.upstream}`);
    return install(options);
  }
  const moved = sync.keepIdenticalFiles
    ? resetKeepingIdenticalFiles(ctx.root, target)
    : git(ctx.root, ["reset", "--keep", target]);
  if (moved.status !== 0) {
    report.warn(
      `reset --keep refused; local edits or an index operation need attention:\n${moved.stderr.trim()}`,
    );
    return 1;
  }
  report.info(
    `${ctx.mainline} ${head.slice(0, 10)} -> ${target.slice(0, 10)}; dropped ${carried.length} landed duplicate(s), uncommitted edits kept`,
  );
  if (options.followSubmodules) {
    for (const line of followPins(
      ctx.root,
      head,
      target,
      options.sharedSubmodules,
    ))
      report.info(line);
  }
  if (options.umask !== undefined)
    reportModes(report, [
      ...restoreModes(ctx.root, head, target),
      ...restoreSubmoduleModes(ctx.root, head, target),
    ]);
  return install(options);
}
