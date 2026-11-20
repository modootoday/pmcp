import { git } from "../exec.js";
import type { GitContext, WorktreesConfig } from "../types.js";
import { worktreeRows } from "./list.js";

export interface WorktreeGcItem {
  readonly path: string;
  readonly alias?: string;
  readonly branch?: string;
  readonly action: "removed" | "would_remove" | "skipped";
  readonly reason?: string;
}

export interface WorktreeGcResult {
  readonly apply: boolean;
  readonly items: WorktreeGcItem[];
}

function isDirty(worktreePath: string): boolean {
  const status = git(worktreePath, ["status", "--porcelain"]);
  return status.status !== 0 || status.stdout.trim().length > 0;
}

// Only desks under config.root are eligible; gate trees and main checkout are never touched.
export function gcWorktrees(
  ctx: GitContext,
  config: WorktreesConfig,
  options: { apply: boolean },
): WorktreeGcResult {
  const rows = worktreeRows(ctx, config);
  const items: WorktreeGcItem[] = [];

  for (const row of rows) {
    if (row.main || !row.alias) continue;
    if (row.path === ctx.root) {
      items.push({
        path: row.path,
        alias: row.alias,
        ...(row.branch ? { branch: row.branch } : {}),
        action: "skipped",
        reason: "current_worktree",
      });
      continue;
    }
    if (isDirty(row.path)) {
      items.push({
        path: row.path,
        alias: row.alias,
        ...(row.branch ? { branch: row.branch } : {}),
        action: "skipped",
        reason: "dirty",
      });
      continue;
    }
    if ((row.ahead ?? 0) > 0) {
      items.push({
        path: row.path,
        alias: row.alias,
        ...(row.branch ? { branch: row.branch } : {}),
        action: "skipped",
        reason: "unlanded_commits",
      });
      continue;
    }
    if (!options.apply) {
      items.push({
        path: row.path,
        alias: row.alias,
        ...(row.branch ? { branch: row.branch } : {}),
        action: "would_remove",
      });
      continue;
    }
    const res = git(ctx.mainRoot, ["worktree", "remove", row.path]);
    items.push({
      path: row.path,
      alias: row.alias,
      ...(row.branch ? { branch: row.branch } : {}),
      action: res.status === 0 ? "removed" : "skipped",
      ...(res.status === 0
        ? {}
        : { reason: res.stderr.trim() || "remove_failed" }),
    });
  }

  return { apply: options.apply, items };
}
