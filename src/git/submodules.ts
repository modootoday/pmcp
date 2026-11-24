import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { git, gitOk, gitText } from "./exec.js";

const GITLINK = /^:160000 160000 ([0-9a-f]{40}) ([0-9a-f]{40}) M\t(.+)$/u;
const DROPPED = /^:160000 000000 [0-9a-f]{40} 0{40} D\t(.+)$/u;

function clean(dir: string): boolean {
  return git(dir, ["status", "--porcelain"]).stdout.trim() === "";
}

function hasCommit(dir: string, sha: string): boolean {
  return gitOk(dir, ["cat-file", "-e", `${sha}^{commit}`]);
}

// git's on-demand submodule fetch runs only when the parent's own fetch brings commits, and a
// checkout sharing the parent's refs has usually fetched them first.
export function fetchedPin(dir: string, sha: string): boolean {
  if (!hasCommit(dir, sha)) git(dir, ["fetch", "-q", "origin"]);
  return hasCommit(dir, sha);
}

// A module cloned bare has no fetch refspec, so no fetch records its origin's branches and
// every commit would look unpushed; fetch them once without touching the config.
function trackOrigin(dir: string): void {
  if (gitOk(dir, ["config", "--get", "remote.origin.fetch"])) return;
  git(dir, ["fetch", "-q", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
}

function pushed(dir: string): boolean {
  trackOrigin(dir);
  return (
    gitText(dir, ["rev-list", "--count", "HEAD", "--not", "--remotes"]) === "0"
  );
}

// Files with uncommitted edits (or untracked) that the move to the pin would touch.
function blocking(dir: string, head: string, pin: string): string[] {
  const local = git(dir, ["status", "--porcelain", "--untracked-files=all"])
    .stdout.split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop()!);
  const changed = new Set(
    gitText(dir, ["diff", "--name-only", head, pin])
      .split("\n")
      .filter(Boolean),
  );
  return local.filter((path) => changed.has(path));
}

// git leaves a removed gitlink's checkout behind as an untracked directory. It goes only when
// nothing in it is lost: its git dir lives in the parent's, no local edits, HEAD on its origin.
function removeDropped(root: string, path: string): string {
  const dir = join(root, path);
  if (!existsSync(dir)) return "removed with its gitlink";
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit))
    return "left as an untracked directory: its gitlink is gone, but it is not a checkout";
  if (statSync(dotGit).isDirectory())
    return "left as an untracked directory: its gitlink is gone, but its git dir is inside it";
  if (!clean(dir))
    return "left as an untracked directory: its gitlink is gone, but it has uncommitted changes";
  if (!pushed(dir))
    return "left as an untracked directory: its gitlink is gone, but it holds commits its origin does not have";
  rmSync(dir, { recursive: true, force: true });
  return "removed: its gitlink is gone, and its checkout was clean with every commit on its origin";
}

// Finds untracked submodule checkouts whose gitlink is not present in HEAD, skipping
// ignored paths, regular files, normal directories and standalone repositories.
function findStrayCheckouts(
  root: string,
  skip: ReadonlySet<string> = new Set(),
): string[] {
  const candidates = new Set<string>();
  const add = (output: string) => {
    for (const raw of output.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      candidates.add(line.endsWith("/") ? line.slice(0, -1) : line);
    }
  };
  add(
    gitText(root, [
      "ls-files",
      "--others",
      "--directory",
      "--exclude-standard",
    ]),
  );
  add(gitText(root, ["ls-files", "--others", "--exclude-standard"]));
  const strays: string[] = [];
  for (const path of Array.from(candidates).sort()) {
    if (skip.has(path)) continue;
    const dotGit = join(root, path, ".git");
    if (!existsSync(dotGit)) continue;
    try {
      if (!statSync(dotGit).isFile()) continue;
    } catch {
      continue;
    }
    if (gitText(root, ["ls-tree", "HEAD", path]).startsWith("160000 ")) {
      continue;
    }
    strays.push(path);
  }
  return strays;
}

// Cleans untracked submodule checkouts left behind without a gitlink in HEAD, preserving
// checkouts with uncommitted edits or unpushed commits.
export function cleanStrayCheckouts(
  root: string,
  skip: ReadonlySet<string> = new Set(),
): string[] {
  const strays = findStrayCheckouts(root, skip);
  return strays.map((path) => `${path}: ${removeDropped(root, path)}`);
}

export function followOne(
  dir: string,
  oldPin: string,
  newPin: string,
  shared: boolean,
): string {
  const short = newPin.slice(0, 10);
  if (!existsSync(join(dir, ".git"))) return "not checked out, left alone";
  const head = gitText(dir, ["rev-parse", "HEAD"]);
  if (head === newPin) return `already at ${short}`;
  // A clean checkout whose commits are all pushed lost nothing by lagging, so it follows too.
  if (head !== oldPin && !(clean(dir) && pushed(dir)))
    return gitText(dir, ["for-each-ref", "--count=1", "refs/remotes"])
      ? `left at ${head.slice(0, 10)}: it was not on the old pin, so it holds other work`
      : `left at ${head.slice(0, 10)}: it was not on the old pin, and what its origin holds is unknown (no remote-tracking refs)`;
  // A shared checkout moves with its edits when they touch no file the pin changes; git
  // refuses otherwise, and nothing is ever restored or discarded here, only named.
  if (!shared && !clean(dir))
    return `left at the old pin: it has uncommitted changes`;
  if (!fetchedPin(dir, newPin))
    return `left at the old pin: ${short} is not fetchable`;
  const branch = gitText(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const args = branch
    ? ["merge", "-q", "--ff-only", newPin]
    : ["checkout", "-q", "--detach", newPin];
  if (!gitOk(dir, args)) {
    const files = shared ? blocking(dir, head, newPin) : [];
    return files.length > 0
      ? `left at the old pin: local edits to ${files.join(", ")} conflict with ${short}; commit or move them, then sync again`
      : `left at the old pin: it cannot move to ${short}`;
  }
  return clean(dir)
    ? `moved to ${short}`
    : `moved to ${short}, keeping its local edits`;
}

// Move only clean submodules still on the old pin so local work is preserved; a shared one
// (declared in [git.submodules] shared) also moves when its edits do not conflict.
export function followPins(
  root: string,
  from: string,
  to: string,
  shared: readonly string[] = [],
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
  const handled = new Set<string>();
  for (const entry of raw.split("\n")) {
    const dropped = DROPPED.exec(entry)?.[1];
    if (dropped) {
      handled.add(dropped);
      lines.push(`${dropped}: ${removeDropped(root, dropped)}`);
      continue;
    }
    const match = GITLINK.exec(entry);
    if (!match) continue;
    const [, oldPin = "", newPin = "", path = ""] = match;
    handled.add(path);
    lines.push(
      `${path}: ${followOne(join(root, path), oldPin, newPin, shared.includes(path))}`,
    );
  }
  for (const line of cleanStrayCheckouts(root, handled)) {
    lines.push(line);
  }
  return lines;
}

export function movableSubmodules(root: string): string[] {
  const listed = git(root, ["submodule", "status"]).stdout;
  return listed
    .split("\n")
    .filter((line) => /^[ +]/u.test(line))
    .map((line) => line.trim().split(/\s+/u)[1] ?? "")
    .filter((path) => {
      const dir = join(root, path);
      if (!path || !existsSync(join(dir, ".git"))) return false;
      return clean(dir) && pushed(dir);
    });
}

export function updateToPins(root: string, paths: readonly string[]): string[] {
  const lines: string[] = [];
  for (const path of paths) {
    const pin = gitText(root, ["rev-parse", "-q", "--verify", `HEAD:${path}`]);
    const dir = join(root, path);
    if (!pin) {
      lines.push(`${path}: ${removeDropped(root, path)}`);
      continue;
    }
    if (!fetchedPin(dir, pin)) {
      lines.push(
        `${path}: left alone, ${pin.slice(0, 10) || "its pin"} is not in its checkout or on its origin`,
      );
      continue;
    }
    if (gitText(dir, ["rev-parse", "HEAD"]) === pin) continue;
    const moved = gitOk(root, ["submodule", "update", "-q", "--", path]);
    lines.push(
      `${path}: ${moved ? `moved to ${pin.slice(0, 10)}` : "update failed"}`,
    );
  }
  return lines;
}
