import { existsSync } from "node:fs";
import { join } from "node:path";

import { git, gitText } from "./exec.js";

const GITLINK = /^:160000 160000 [0-9a-f]{40} ([0-9a-f]{40}) M$/u;

// Where a submodule's commits can be read: its checkout here, else the repository git keeps
// for it under the common directory (a linked worktree that never checked it out).
function submoduleRepo(cwd: string, path: string): string | null {
  const checkout = join(cwd, path);
  if (existsSync(join(checkout, ".git"))) return checkout;
  const common = gitText(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const kept = common ? join(common, "modules", path) : "";
  return kept && existsSync(kept) ? kept : null;
}

// A commit that only moves submodule pins, each to a commit the upstream's pin for that path
// equals or already contains, brings nothing the upstream lacks. Anything else in the commit,
// a pin added or removed, a merge, or a submodule whose history is not here, and it does.
export function pinsSuperseded(
  cwd: string,
  upstream: string,
  sha: string,
): boolean {
  const parents = gitText(cwd, ["rev-list", "--parents", "-n", "1", sha]);
  if (parents.split(" ").length !== 2) return false;
  const diff = git(cwd, [
    "diff-tree",
    "--raw",
    "--no-commit-id",
    "--no-renames",
    "--abbrev=40",
    "-z",
    "-r",
    `${sha}^`,
    sha,
  ]);
  const fields = diff.stdout.split("\0").slice(0, -1);
  if (diff.status !== 0 || fields.length === 0 || fields.length % 2 !== 0)
    return false;
  for (let index = 0; index < fields.length; index += 2) {
    const pin = GITLINK.exec(fields[index] ?? "")?.[1];
    const path = fields[index + 1];
    if (pin === undefined || !path) return false;
    const listed = gitText(cwd, ["ls-tree", upstream, "--", path]);
    const theirs = /^160000 commit ([0-9a-f]{40})\t/u.exec(listed)?.[1];
    if (theirs === undefined) return false;
    if (theirs === pin) continue;
    const repo = submoduleRepo(cwd, path);
    if (repo === null) return false;
    if (git(repo, ["merge-base", "--is-ancestor", pin, theirs]).status !== 0)
      return false;
  }
  return true;
}
