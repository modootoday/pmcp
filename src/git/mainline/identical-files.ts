import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

import { git, type Result } from "../exec.js";

const FILE_MODES = new Set(["100644", "100755"]);

function refuse(path: string): Result {
  return {
    status: 1,
    stdout: "",
    stderr: `untracked file differs from the target: ${path}\n`,
  };
}

// Only identical plain files can survive a move without losing untracked content.
function identical(
  cwd: string,
  path: string,
  mode: string,
  oid: string,
): boolean {
  if (!FILE_MODES.has(mode)) return false;
  let current = cwd;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) return false;
  }
  const stat = lstatSync(current);
  if (!stat.isFile()) return false;
  if (Boolean(stat.mode & 0o111) !== (mode === "100755")) return false;
  const blob = spawnSync("git", ["cat-file", "blob", oid], { cwd });
  return blob.status === 0 && readFileSync(current).equals(blob.stdout);
}

function adopt(
  cwd: string,
  target: string,
  env: Record<string, string>,
): Result | null {
  const incoming = git(cwd, ["ls-tree", "-rz", "--full-tree", target], env);
  const tracked = git(cwd, ["ls-tree", "-rz", "--name-only", "HEAD"], env);
  const indexed = git(cwd, ["ls-files", "--cached", "-z"], env);
  for (const run of [incoming, tracked, indexed]) {
    if (run.status !== 0) return run;
  }
  const existing = new Set([
    ...tracked.stdout.split("\0"),
    ...indexed.stdout.split("\0"),
  ]);
  for (const entry of incoming.stdout.split("\0")) {
    const match = /^(\d+) \w+ ([0-9a-f]+)\t([\s\S]+)$/u.exec(entry);
    if (!match) continue;
    const [, mode = "", oid = "", path = ""] = match;
    if (existing.has(path)) continue;
    if (!lstatSync(join(cwd, path), { throwIfNoEntry: false })) continue;
    if (!identical(cwd, path, mode, oid)) return refuse(path);
    const added = git(
      cwd,
      ["update-index", "--add", "--cacheinfo", `${mode},${oid},${path}`],
      env,
    );
    if (added.status !== 0) return added;
  }
  return null;
}

export function resetKeepingIdenticalFiles(
  cwd: string,
  target: string,
): Result {
  const located = git(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  if (located.status !== 0) return located;
  const index = located.stdout.trim();
  const lock = `${index}.lock`;
  let fd: number | undefined;
  let temporary: string | undefined;
  let movedHead = false;
  try {
    fd = openSync(lock, "wx");
    temporary = mkdtempSync(`${index}.sync-`);
    const scratch = join(temporary, "index");
    copyFileSync(index, scratch);
    const env = { GIT_INDEX_FILE: scratch };
    const refused = adopt(cwd, target, env);
    if (refused !== null) return refused;
    const moved = git(cwd, ["reset", "--keep", target], env);
    if (moved.status !== 0) return moved;
    movedHead = true;
    copyFileSync(scratch, lock);
    closeSync(fd);
    fd = undefined;
    renameSync(lock, index);
    rmSync(temporary, { recursive: true, force: true });
    return moved;
  } catch (error) {
    const recovery = movedHead
      ? `; HEAD moved, recovery index kept at ${temporary}/index`
      : "";
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 1, stdout: "", stderr: `${reason}${recovery}\n` };
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (temporary !== undefined && !movedHead)
      rmSync(temporary, { recursive: true, force: true });
    if (fd !== undefined && !movedHead && existsSync(lock)) rmSync(lock);
  }
}
