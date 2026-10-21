import { join, relative, sep } from "node:path";

import { listWorktrees } from "../detect.js";
import { distance } from "../landed.js";
import type { GitContext, WorktreesConfig } from "../types.js";

export interface WorktreeRow {
  readonly path: string;
  readonly alias?: string;
  readonly branch?: string;
  readonly main: boolean;
  readonly behind?: number;
  readonly ahead?: number;
}

export function worktreeRows(
  ctx: GitContext,
  config: WorktreesConfig,
): WorktreeRow[] {
  const root = join(ctx.mainRoot, config.root);
  return listWorktrees(ctx.mainRoot)
    .filter((entry) => !entry.bare)
    .map((entry) => {
      const inside = relative(root, entry.path);
      const alias =
        inside && !inside.startsWith("..") && !inside.includes(sep)
          ? inside
          : undefined;
      const counted = distance(entry.path, ctx.upstream);
      return {
        path: entry.path,
        ...(alias === undefined ? {} : { alias }),
        ...(entry.branch === undefined ? {} : { branch: entry.branch }),
        main: entry.path === ctx.mainRoot,
        ...(counted ?? {}),
      };
    });
}
