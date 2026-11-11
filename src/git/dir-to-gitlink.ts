import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ADDED_GITLINK } from "./added-submodules.js";
import { git, gitText } from "./exec.js";
import type { SubmodulesConfig } from "./types.js";

// [git.submodules] dir_to_gitlink: what a sync does when the move turns a tracked directory
// that still holds files into a gitlink. "adopt" moves and checks the gitlink out after;
// "refuse" leaves the checkout where it is, so its files stay for a separate adoption step.
export interface DirToGitlinkPolicy {
  readonly mode: "adopt" | "refuse";
  readonly hint?: string;
}

export function dirToGitlinkPolicy(
  submodules: SubmodulesConfig | undefined,
): DirToGitlinkPolicy {
  if (submodules === undefined) return { mode: "adopt" };
  return {
    mode: submodules.dirToGitlink,
    ...(submodules.dirToGitlinkHint === undefined
      ? {}
      : { hint: submodules.dirToGitlinkHint }),
  };
}

// Paths that are a directory at from, a gitlink at to, and not empty in the working tree.
export function dirsBecomingGitlinks(
  root: string,
  from: string,
  to: string,
): string[] {
  const raw = gitText(root, [
    "diff",
    "--raw",
    "--abbrev=40",
    "--no-renames",
    from,
    to,
  ]);
  const paths: string[] = [];
  for (const entry of raw.split("\n")) {
    const added = ADDED_GITLINK.exec(entry);
    if (!added) continue;
    const path = added[2] ?? "";
    const kind = git(root, ["cat-file", "-t", `${from}:${path}`]);
    if (kind.status !== 0 || kind.stdout.trim() !== "tree") continue;
    const dir = join(root, path);
    if (existsSync(dir) && readdirSync(dir).length > 0) paths.push(path);
  }
  return paths;
}

// The refusal to report, or null when the move may go ahead.
export function dirToGitlinkRefusal(
  root: string,
  from: string,
  to: string,
  policy: DirToGitlinkPolicy | undefined,
): string | null {
  if (policy?.mode !== "refuse") return null;
  const paths = dirsBecomingGitlinks(root, from, to);
  if (paths.length === 0) return null;
  const hint = policy.hint === undefined ? "" : `; ${policy.hint}`;
  return `the move turns ${paths.join(", ")} from a directory with files into a gitlink ([git.submodules] dir_to_gitlink = "refuse"); left where it is${hint}`;
}
