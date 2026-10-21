import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

import type { TouchedPath } from "../../../sessions/types.js";

const TOUCHED_KEPT = 50;

export function addTouched(
  touched: readonly TouchedPath[],
  root: string,
  target: string,
): TouchedPath[] {
  const path = relative(
    root,
    isAbsolute(target) ? target : resolve(root, target),
  );
  if (
    !path ||
    path.startsWith("..") ||
    touched.some((entry) => entry.path === path)
  )
    return [...touched];
  return [...touched, { path, at: new Date().toISOString() }].slice(
    -TOUCHED_KEPT,
  );
}

function porcelainPaths(text: string): string[] {
  const fields = text.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]!;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") index += 1;
  }
  return paths;
}

// Limit diff queries to touched paths so notices remain cheap in large checkouts.
export function stillDirty(root: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const result = spawnSync(
    "git",
    [
      "status",
      "--porcelain",
      "-z",
      "--ignore-submodules=all",
      "--untracked-files=all",
      "--",
      ...paths,
    ],
    { cwd: root, encoding: "utf8", timeout: 5000 },
  );
  if (result.status !== 0) throw new Error("git status failed");
  const listed = porcelainPaths(result.stdout);
  return paths.filter((path) =>
    listed.some((entry) => entry === path || entry.startsWith(`${path}/`)),
  );
}
