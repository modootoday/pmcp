import { mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, gitText } from "../exec.js";

export type Replayed = { readonly tip: string } | { readonly error: string };

function remove(root: string, dir: string): string | null {
  const removed = git(root, ["worktree", "remove", "--force", dir]);
  if (removed.status !== 0)
    return `worktree cleanup failed; preserved ${dir}: ${removed.stderr.trim()}`;
  rmSync(dir, { recursive: true, force: true });
  return null;
}

// git's hints name cherry-pick --continue/--skip/--abort in a worktree that is already gone.
function withoutHints(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith("hint:"))
    .join("\n")
    .trim();
}

function pick(dir: string, base: string, commits: readonly string[]): Replayed {
  const picked = git(dir, [
    "-c",
    "core.hooksPath=/dev/null",
    "cherry-pick",
    ...commits,
  ]);
  if (picked.status === 0) return { tip: gitText(dir, ["rev-parse", "HEAD"]) };
  // Name conflict files so lockfile regeneration can be distinguished from code conflict resolution.
  const conflicted = gitText(dir, ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean);
  git(dir, ["cherry-pick", "--abort"]);
  return {
    error: `the replay conflicts with the upstream in ${conflicted.join(", ") || "unknown files"}:\n${withoutHints(picked.stderr)}\nnothing was pushed; rebase onto ${base} and deliver again`,
  };
}

export function replay(
  root: string,
  base: string,
  commits: readonly string[],
): Replayed {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-deliver-"));
  const added = git(root, ["worktree", "add", "-q", "--detach", dir, base]);
  if (added.status !== 0) {
    rmdirSync(dir);
    return { error: `worktree add failed: ${added.stderr.trim()}` };
  }
  const result = pick(dir, base, commits);
  const cleanup = remove(root, dir);
  if (cleanup === null) return result;
  const prior = "error" in result ? `${result.error}\n` : "";
  return { error: `${prior}${cleanup}` };
}
