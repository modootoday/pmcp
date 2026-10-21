import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { git, gitText } from "./exec.js";
import type { GitContext } from "./types.js";

export interface WorktreeEntry {
  readonly path: string;
  readonly head: string;
  readonly branch?: string;
  readonly detached: boolean;
  readonly bare: boolean;
}

// Use the common git directory so all worktrees share one repository identity.
export function projectId(commonDir: string): string {
  return createHash("sha256").update(realpathSync(commonDir)).digest("hex");
}

export function defaultRemote(root: string, preferred?: string): string {
  if (preferred !== undefined) return preferred;
  const remotes = gitText(root, ["remote"]).split("\n").filter(Boolean);
  if (remotes.includes("origin")) return "origin";
  return remotes[0] ?? "origin";
}

export function defaultMainline(
  root: string,
  remote: string,
  preferred?: string,
): string {
  if (preferred !== undefined) return preferred;
  const head = gitText(root, [
    "symbolic-ref",
    "-q",
    `refs/remotes/${remote}/HEAD`,
  ]);
  const prefix = `refs/remotes/${remote}/`;
  if (head.startsWith(prefix)) return head.slice(prefix.length);
  return "main";
}

export function detect(
  cwd: string,
  prefs: { readonly remote?: string; readonly mainline?: string } = {},
): GitContext | null {
  const root = gitText(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const gitDir = gitText(root, ["rev-parse", "--absolute-git-dir"]);
  const commonDir = gitText(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!gitDir || !commonDir) return null;
  const remote = defaultRemote(root, prefs.remote);
  const mainline = defaultMainline(root, remote, prefs.mainline);
  return {
    root: resolve(root),
    gitDir: resolve(gitDir),
    commonDir: resolve(commonDir),
    mainRoot: dirname(resolve(commonDir)),
    linked: resolve(gitDir) !== resolve(commonDir),
    remote,
    mainline,
    upstream: `${remote}/${mainline}`,
    projectId: projectId(commonDir),
  };
}

export function listWorktrees(root: string): WorktreeEntry[] {
  const listed = git(root, ["worktree", "list", "--porcelain"]).stdout;
  const entries: WorktreeEntry[] = [];
  for (const block of listed.split("\n\n")) {
    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      const space = line.indexOf(" ");
      if (space === -1) fields.set(line, "");
      if (space !== -1) fields.set(line.slice(0, space), line.slice(space + 1));
    }
    const path = fields.get("worktree");
    if (path === undefined) continue;
    const branch = fields.get("branch")?.replace(/^refs\/heads\//u, "");
    entries.push({
      path,
      head: fields.get("HEAD") ?? "",
      ...(branch === undefined ? {} : { branch }),
      detached: fields.has("detached"),
      bare: fields.has("bare"),
    });
  }
  return entries;
}
