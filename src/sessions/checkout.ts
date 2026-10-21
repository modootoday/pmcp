import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

// Read git files directly so common hooks do not pay subprocess startup cost.
export interface Checkout {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly branch: string;

  readonly main: boolean;
}

function gitDirOf(root: string): string | null {
  const dotGit = join(root, ".git");
  if (statSync(dotGit).isDirectory()) return realpathSync(dotGit);
  const pointer = /^gitdir:\s*(.+)$/mu
    .exec(readFileSync(dotGit, "utf8"))?.[1]
    ?.trim();
  return pointer ? realpathSync(resolve(root, pointer)) : null;
}

function commonDirOf(gitDir: string): string {
  const file = join(gitDir, "commondir");
  if (!existsSync(file)) return gitDir;
  return realpathSync(resolve(gitDir, readFileSync(file, "utf8").trim()));
}

function branchOf(gitDir: string): string {
  const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
  return head.startsWith("ref: refs/heads/")
    ? head.slice("ref: refs/heads/".length)
    : "";
}

export function checkoutOf(path: string): Checkout | null {
  let dir = resolve(path);
  for (;;) {
    try {
      if (existsSync(join(dir, ".git"))) {
        const gitDir = gitDirOf(dir);
        if (!gitDir) return null;
        const commonDir = commonDirOf(gitDir);
        return {
          root: dir,
          gitDir,
          commonDir,
          branch: branchOf(gitDir),
          main: gitDir === commonDir,
        };
      }
    } catch {
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function gitCommonDir(root: string): string | null {
  return checkoutOf(root)?.commonDir ?? null;
}

export function worktreesOf(
  checkout: Checkout,
): { path: string; branch: string }[] {
  const found = [
    { path: dirname(checkout.commonDir), branch: branchOf(checkout.commonDir) },
  ];
  let names: string[] = [];
  try {
    names = readdirSync(join(checkout.commonDir, "worktrees"));
  } catch {
    return found;
  }
  for (const name of names) {
    const admin = join(checkout.commonDir, "worktrees", name);
    try {
      const dotGit = readFileSync(join(admin, "gitdir"), "utf8").trim();
      found.push({ path: dirname(dotGit), branch: branchOf(admin) });
    } catch {
      // A worktree being added or pruned has no gitdir yet.
    }
  }
  return found;
}

export function hasLinkedWorktrees(checkout: Checkout): boolean {
  try {
    return readdirSync(join(checkout.commonDir, "worktrees")).length > 0;
  } catch {
    return false;
  }
}
