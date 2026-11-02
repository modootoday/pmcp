import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { git, gitText, gitWithInput } from "./exec.js";

const ADDED_GITLINK = /^:\d{6} 160000 [0-9a-f]{40} ([0-9a-f]{40}) [AT]\t(.+)$/u;

// Checks out each gitlink the move from..to adds, often a directory split into its own
// repository. One line per gitlink.
export function initAddedSubmodules(
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
  const lines: string[] = [];
  for (const entry of raw.split("\n")) {
    const added = ADDED_GITLINK.exec(entry);
    if (!added) continue;
    const [, pin = "", path = ""] = added;
    lines.push(`${path}: ${initOne(root, path, pin, from)}`);
  }
  return lines;
}

// A path that was a plain directory keeps its ignored files (install and build output)
// after the move. Ignored-only content is moved aside under the git dir, never deleted;
// anything else is named for the operator.
function initOne(
  root: string,
  path: string,
  pin: string,
  from: string,
): string {
  const dir = join(root, path);
  if (existsSync(join(dir, ".git"))) return "already checked out";
  let displaced = "";
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    if (unignoredFiles(root, path, from).length > 0)
      return `new submodule not checked out: ${path} holds files git does not ignore; move them aside, then git submodule update --init ${path}`;
    displaced = displace(root, path);
  }
  const done = git(root, ["submodule", "update", "--init", "-q", "--", path]);
  const aside = displaced
    ? `; its ignored files from before are in ${displaced}, so run the install again`
    : "";
  if (done.status !== 0)
    return `new submodule not checked out: ${done.stderr.trim()}${aside}`;
  return `new submodule checked out at ${pin.slice(0, 10)}${aside}`;
}

// Files under path that no ignore rule covers. An ignored directory is not descended, so a
// node_modules tree costs one check. The index may already hold path as a gitlink, so the
// rules are read with --no-index and paths go on stdin, where git does not refuse them.
// The directory's own .gitignore files left with its tracked files, so they are put back
// from the old commit for the check and removed after it.
function unignoredFiles(root: string, path: string, from: string): string[] {
  const restored = restoreIgnoreFiles(root, path, from);
  const own = new Set(restored);
  const kept: string[] = [];
  try {
    let level = [path];
    while (level.length > 0) {
      const entries = level.flatMap((dir) =>
        readdirSync(join(root, dir), { withFileTypes: true }).map((entry) => ({
          path: `${dir}/${entry.name}`,
          dir: entry.isDirectory(),
        })),
      );
      const checked = gitWithInput(
        root,
        ["check-ignore", "--no-index", "--stdin", "-z"],
        entries.map((entry) => `${entry.path}\0`).join(""),
      );
      const ignored = new Set(checked.stdout.split("\0").filter(Boolean));
      const open = entries.filter(
        (entry) => !ignored.has(entry.path) && !own.has(entry.path),
      );
      kept.push(
        ...open.filter((entry) => !entry.dir).map((entry) => entry.path),
      );
      level = open.filter((entry) => entry.dir).map((entry) => entry.path);
    }
  } finally {
    for (const file of restored) rmSync(join(root, file));
  }
  return kept;
}

// Writes each .gitignore the old commit had under path back where its directory still
// stands; returns the paths written.
function restoreIgnoreFiles(
  root: string,
  path: string,
  from: string,
): string[] {
  const listed = git(root, [
    "ls-tree",
    "-r",
    "-z",
    "--name-only",
    from,
    "--",
    path,
  ]);
  if (listed.status !== 0) return [];
  const restored: string[] = [];
  for (const file of listed.stdout.split("\0")) {
    if (!file.endsWith("/.gitignore")) continue;
    const target = join(root, file);
    if (existsSync(target) || !existsSync(dirname(target))) continue;
    const body = git(root, ["show", `${from}:${file}`]);
    if (body.status !== 0) continue;
    writeFileSync(target, body.stdout);
    restored.push(file);
  }
  return restored;
}

// Moves path under the git dir, where no checkout and no clean reaches it.
function displace(root: string, path: string): string {
  const gitDir = gitText(root, ["rev-parse", "--absolute-git-dir"]);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const target = join(gitDir, "pmcp-displaced", stamp, path);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(root, path), target);
  return target;
}
