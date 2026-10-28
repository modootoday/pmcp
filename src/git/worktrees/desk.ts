import { relative } from "node:path";

import { globPattern } from "../../glob.js";
import { gitText } from "../exec.js";
import type { InstallSpec } from "../install.js";
import type { SessionGate } from "../mainline/store.js";
import { inProgress, type SyncResult } from "../mainline/sync.js";
import type {
  GitContext,
  LeaseSpec,
  Reporter,
  WorktreesConfig,
} from "../types.js";
import { syncWorktree } from "./sync.js";

// Derived, never configured per checkout: the main checkout (its .git a directory) is shared,
// a linked worktree under [git.worktrees] desks is a desk, any other linked one is scratch.
export type CheckoutKind = "shared" | "desk" | "scratch";

export function checkoutKind(
  ctx: GitContext,
  worktrees: WorktreesConfig | undefined,
): CheckoutKind {
  if (!ctx.linked) return "shared";
  if (worktrees === undefined) return "scratch";
  const path = relative(ctx.mainRoot, ctx.root).split("\\").join("/");
  return globPattern(worktrees.desks, false).test(path) ? "desk" : "scratch";
}

export interface DeskSyncOptions {
  readonly ctx: GitContext;
  readonly followSubmodules: boolean;
  readonly install?: InstallSpec;
  readonly store: SessionGate;
  readonly leases: readonly LeaseSpec[];
  readonly report: Reporter;
  readonly umask?: number;
}

// What blocks moving a desk before git is asked: a pause, another session's live lease, or a
// git operation in progress. Leases this process holds (a delivery's) do not.
function blocked(options: DeskSyncOptions): string | null {
  const pause = options.store.pause.read();
  if (pause !== null)
    return `the sessions are paused (${pause.reason}, since ${pause.since})`;
  for (const spec of options.leases) {
    const lease = options.store.leases.read(spec.name);
    if (lease !== null && lease.pid !== process.pid)
      return `lease ${spec.name} is held by ${lease.subject} (pid ${lease.pid})`;
  }
  return inProgress(options.ctx);
}

// Bring a desk up to date: fast-forward, or reset --keep when every desk commit is landed, then
// follow clean submodule pins and install when the lockfile moved. Uncommitted tracked edits
// or an unlanded commit hold it where it is (code 1); nothing is rebased.
export function syncDesk(options: DeskSyncOptions): SyncResult {
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
  const refused = blocked(options);
  if (refused !== null) {
    report.warn(`${refused}; the desk stays where it is`);
    return { from, to: from, code: 1, ...(reason ? { reason } : {}) };
  }
  const moved = syncWorktree({
    ctx: options.ctx,
    followSubmodules: options.followSubmodules,
    report,
    ...(options.install === undefined ? {} : { install: options.install }),
    ...(options.umask === undefined ? {} : { umask: options.umask }),
  });
  return {
    from,
    to: head(),
    code: moved === "held" ? 1 : 0,
    ...(reason ? { reason } : {}),
  };
}
