import { chmodSync, lstatSync } from "node:fs";
import { join } from "node:path";

import { gitText } from "./exec.js";
import type { Reporter } from "./types.js";

// [git] umask: files pmcp's git commands write in checkouts take this umask, and tracked files
// they rewrote get their index mode back. A checkout run under a strict umask otherwise left
// tracked files 0600, and a container reading a bind-mounted config as another user failed.

export function withUmask<T>(mask: number | undefined, run: () => T): T {
  if (mask === undefined) return run();
  let before: number;
  try {
    before = process.umask(mask);
  } catch {
    // A worker thread cannot set it; the index-mode backstop still applies.
    return run();
  }
  try {
    return run();
  } finally {
    process.umask(before);
  }
}

const INDEX_MODES: Readonly<Record<string, number>> = {
  "100644": 0o644,
  "100755": 0o755,
};

// Tracked files that `from` -> `to` changed (every tracked file when `from` is null) get the
// mode the index records. Untracked files, symlinks and submodules are never touched.
export function restoreModes(
  root: string,
  from: string | null,
  to: string,
): string[] {
  const paths =
    from === null
      ? null
      : gitText(root, ["diff", "--name-only", "--no-renames", "-z", from, to])
          .split("\0")
          .filter(Boolean);
  if (paths !== null && paths.length === 0) return [];
  const listed = gitText(root, [
    "ls-files",
    "-s",
    "-z",
    ...(paths === null ? [] : ["--", ...paths]),
  ]);
  const fixed: string[] = [];
  for (const entry of listed.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const want = INDEX_MODES[entry.slice(0, 6)];
    if (want === undefined) continue;
    const path = entry.slice(tab + 1);
    const file = join(root, path);
    let mode: number;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile()) continue;
      mode = stat.mode & 0o777;
    } catch {
      continue;
    }
    if (mode === want) continue;
    chmodSync(file, want);
    fixed.push(path);
  }
  return fixed;
}

const GITLINK =
  /^:(?:160000|000000) 160000 ([0-9a-f]{40}) ([0-9a-f]{40}) [AM]\t(.+)$/u;

// The same for each submodule checkout that now sits on the pin `from` -> `to` set.
export function restoreSubmoduleModes(
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
  const fixed: string[] = [];
  for (const line of raw.split("\n")) {
    const match = GITLINK.exec(line);
    if (!match) continue;
    const [, before, after, path] = match as unknown as [
      string,
      string,
      string,
      string,
    ];
    const dir = join(root, path);
    if (gitText(dir, ["rev-parse", "HEAD"]) !== after) continue;
    const old = /^0+$/u.test(before) ? null : before;
    for (const file of restoreModes(dir, old, after))
      fixed.push(`${path}/${file}`);
  }
  return fixed;
}

export function reportModes(report: Reporter, fixed: readonly string[]): void {
  if (fixed.length === 0) return;
  const shown = fixed.slice(0, 5).join(", ");
  const more = fixed.length > 5 ? `, and ${fixed.length - 5} more` : "";
  report.info(
    `gave ${fixed.length} rewritten tracked file(s) their index mode back: ${shown}${more}`,
  );
}
