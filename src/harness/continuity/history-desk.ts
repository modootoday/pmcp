import { execFileSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { relative } from "node:path";

function gitPath(cwd: string, option: string): string | null {
  try {
    return (
      execFileSync("git", ["rev-parse", option], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export async function historyDesk(path: string) {
  const location = await realpath(path);
  if (!(await stat(location)).isDirectory())
    throw new Error("invalid_history_worktree");
  let worktree = gitPath(location, "--show-toplevel") ?? location;
  for (
    let parent = gitPath(worktree, "--show-superproject-working-tree");
    parent && parent !== worktree;
    parent = gitPath(worktree, "--show-superproject-working-tree")
  ) {
    worktree = parent;
  }
  return {
    worktree,
    previousDirectory: relative(worktree, location) || undefined,
  };
}
