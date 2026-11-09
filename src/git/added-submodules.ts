import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { displacedDir } from "../sessions/state-dir.js";
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
// after the move. Ignored-only content is moved to the state directory, never deleted;
// anything else is named for the operator.
function initOne(
  root: string,
  path: string,
  pin: string,
  from: string,
): string {
  const dir = join(root, path);
  if (existsSync(join(dir, ".git"))) return followLeftCheckout(root, path, pin);
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

// A checkout left from an earlier gitlink at the same path moves to the new pin only when
// it holds nothing of its own; its commits stay in its repository either way.
function followLeftCheckout(root: string, path: string, pin: string): string {
  const dir = join(root, path);
  const head = git(dir, ["rev-parse", "HEAD"]);
  if (head.status === 0 && head.stdout.trim() === pin)
    return "already checked out";
  const status = git(dir, ["status", "--porcelain", "--ignored"]);
  if (status.status !== 0 || status.stdout.trim() !== "")
    return `new submodule not checked out: the earlier checkout in ${path} holds changes or ignored files; move it aside, then git submodule update --init ${path}`;
  const done = git(root, ["submodule", "update", "--init", "-q", "--", path]);
  if (done.status !== 0)
    return `new submodule not checked out: ${done.stderr.trim()}`;
  return `earlier checkout moved to the new pin ${pin.slice(0, 10)}`;
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

// Moves path out of the checkout into the state directory. A state directory on another
// file system takes a copy first, and the source goes only once the copy is complete.
function displace(root: string, path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const target = join(displacedDir(root), stamp, path);
  mkdirSync(dirname(target), { recursive: true });
  const source = join(root, path);
  try {
    renameSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    cpSync(source, target, {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    rmSync(source, { recursive: true, force: true });
  }
  return target;
}
