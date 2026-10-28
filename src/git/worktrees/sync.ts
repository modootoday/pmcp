import { git, gitText } from "../exec.js";
import { installIfStale, type InstallSpec } from "../install.js";
import { cherry, distance, GitReadError } from "../landed.js";
import {
  reportModes,
  restoreModes,
  restoreSubmoduleModes,
  withUmask,
} from "../modes.js";
import { movableSubmodules, updateToPins } from "../submodules.js";
import type { GitContext, Reporter } from "../types.js";

export interface WorktreeSyncOptions {
  readonly ctx: GitContext;
  readonly followSubmodules: boolean;
  readonly install?: InstallSpec;
  readonly fetch?: boolean;
  readonly report: Reporter;
  // [git] umask: the move and the install run under it, and rewritten tracked files get their
  // index mode back.
  readonly umask?: number;
}

export type WorktreeSyncResult = "current" | "moved" | "held";

// A read that fails holds the worktree: an empty answer is not "clean" or "all landed".
function heldBy(root: string, upstream: string, ahead: number): string | null {
  const status = git(root, [
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--ignore-submodules=all",
  ]);
  if (status.status !== 0)
    return `git status failed (exit ${status.status}): ${status.stderr.trim()}`;
  if (status.stdout.trim()) return "uncommitted changes";
  if (ahead === 0) return null;
  let own: number;
  try {
    own = cherry(root, upstream).missing.length;
  } catch (error) {
    if (error instanceof GitReadError) return error.message;
    throw error;
  }
  if (own > 0) return `${own} unlanded commit(s)`;
  return null;
}

export function syncWorktree(options: WorktreeSyncOptions): WorktreeSyncResult {
  return withUmask(options.umask, () => syncOnce(options));
}

function syncOnce(options: WorktreeSyncOptions): WorktreeSyncResult {
  const { ctx, report } = options;
  if (!ctx.linked)
    throw new Error(
      "worktree sync moves a linked worktree; the main checkout uses pmcp git sync",
    );
  if (
    options.fetch !== false &&
    git(ctx.root, ["fetch", "-q", ctx.remote, ctx.mainline]).status !== 0
  )
    report.warn(
      `fetch from ${ctx.remote} failed; judging against the last fetched ${ctx.upstream}`,
    );
  const counted = distance(ctx.root, ctx.upstream);
  if (counted === null)
    throw new Error(`cannot compare HEAD with ${ctx.upstream}`);
  if (counted.behind === 0) {
    report.info(`already on ${ctx.upstream}`);
    if (options.install !== undefined)
      installIfStale(ctx.root, options.install, report);
    return "current";
  }
  const holds = heldBy(ctx.root, ctx.upstream, counted.ahead);
  if (holds !== null) {
    report.warn(
      `${counted.behind} commit(s) behind ${ctx.upstream} and holds ${holds}; left where it is`,
    );
    return "held";
  }
  const submodules = options.followSubmodules
    ? movableSubmodules(ctx.root)
    : [];
  const before = gitText(ctx.root, ["rev-parse", "HEAD"]);
  // Discard only landed copies so desk synchronization does not lose undelivered commits.
  const args =
    counted.ahead > 0
      ? ["reset", "--keep", "-q", ctx.upstream]
      : ["merge", "--ff-only", "-q", ctx.upstream];
  const moved = git(ctx.root, args);
  if (moved.status !== 0) {
    report.warn(
      `could not move to ${ctx.upstream}: ${moved.stderr.trim().split("\n")[0] ?? ""}`,
    );
    return "held";
  }
  const after = gitText(ctx.root, ["rev-parse", "HEAD"]);
  report.info(
    `moved ${before.slice(0, 10)} -> ${after.slice(0, 10)}, ${counted.behind} commit(s)`,
  );
  for (const line of updateToPins(ctx.root, submodules)) report.info(line);
  if (options.umask !== undefined)
    reportModes(report, [
      ...restoreModes(ctx.root, before, after),
      ...restoreSubmoduleModes(ctx.root, before, after),
    ]);
  if (options.install !== undefined)
    installIfStale(ctx.root, options.install, report);
  return "moved";
}
