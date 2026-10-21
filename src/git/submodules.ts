import { existsSync } from "node:fs";
import { join } from "node:path";

import { git, gitOk, gitText } from "./exec.js";

const GITLINK = /^:160000 160000 ([0-9a-f]{40}) ([0-9a-f]{40}) M\t(.+)$/u;

function clean(dir: string): boolean {
  return git(dir, ["status", "--porcelain"]).stdout.trim() === "";
}

function hasCommit(dir: string, sha: string): boolean {
  return gitOk(dir, ["cat-file", "-e", `${sha}^{commit}`]);
}

function followOne(dir: string, oldPin: string, newPin: string): string {
  const short = newPin.slice(0, 10);
  if (!existsSync(join(dir, ".git"))) return "not checked out, left alone";
  const head = gitText(dir, ["rev-parse", "HEAD"]);
  if (head === newPin) return `already at ${short}`;
  if (head !== oldPin)
    return `left at ${head.slice(0, 10)}: it was not on the old pin, so it holds other work`;
  if (!clean(dir)) return `left at the old pin: it has uncommitted changes`;
  if (!hasCommit(dir, newPin)) git(dir, ["fetch", "-q", "origin"]);
  if (!hasCommit(dir, newPin))
    return `left at the old pin: ${short} is not fetchable`;
  const branch = gitText(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const args = branch
    ? ["merge", "-q", "--ff-only", newPin]
    : ["checkout", "-q", "--detach", newPin];
  if (!gitOk(dir, args))
    return `left at the old pin: it cannot move to ${short}`;
  return `moved to ${short}`;
}

// Move only clean submodules still on the old pin so local work is preserved.
export function followPins(root: string, from: string, to: string): string[] {
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
    const match = GITLINK.exec(entry);
    if (!match) continue;
    const [, oldPin = "", newPin = "", path = ""] = match;
    lines.push(`${path}: ${followOne(join(root, path), oldPin, newPin)}`);
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
      const local = gitText(dir, [
        "rev-list",
        "--count",
        "HEAD",
        "--not",
        "--remotes",
      ]);
      return clean(dir) && local === "0";
    });
}

export function updateToPins(root: string, paths: readonly string[]): string[] {
  const lines: string[] = [];
  for (const path of paths) {
    const pin = gitText(root, ["rev-parse", `HEAD:${path}`]);
    const dir = join(root, path);
    if (!pin || !hasCommit(dir, pin)) {
      lines.push(
        `${path}: left alone, ${pin.slice(0, 10) || "its pin"} is not in its checkout`,
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
