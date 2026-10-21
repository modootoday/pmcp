import { realpathSync } from "node:fs";

import { checkoutOf, worktreesOf } from "../../sessions/checkout.js";
import type { GitProbe } from "./types.js";

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// Read git metadata directly to avoid subprocess cost on the hook path.
export const gitProbe: GitProbe = {
  toplevel(cwd) {
    return checkoutOf(cwd)?.root ?? null;
  },
  worktrees(cwd) {
    const checkout = checkoutOf(cwd);
    if (!checkout) return [];
    return worktreesOf(checkout).map((tree) => ({
      path: real(tree.path),
      branch: tree.branch || null,
    }));
  },
};
