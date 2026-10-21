import { existsSync } from "node:fs";
import { join } from "node:path";

import { git, gitOk, gitText } from "../exec.js";
import type { Reporter } from "../types.js";

const GITLINK =
  /^:(?:160000|000000) 160000 [0-9a-f]{40} ([0-9a-f]{40}) [AM]\t(.+)$/u;

// The submodule pins the commits being delivered set, from the upstream to their tip.
function pins(root: string, upstream: string, tip: string): [string, string][] {
  const raw = gitText(root, [
    "diff",
    "--raw",
    "--abbrev=40",
    "--no-renames",
    upstream,
    tip,
  ]);
  const found: [string, string][] = [];
  for (const line of raw.split("\n")) {
    const match = GITLINK.exec(line);
    if (match) found.push([match[2]!, match[1]!]);
  }
  return found;
}

function branchOf(root: string, path: string): string {
  const named = gitText(root, [
    "config",
    "-f",
    ".gitmodules",
    "--get",
    `submodule.${path}.branch`,
  ]);
  return named || "main";
}

// Before the mainline moves to a commit that pins a submodule, the pin must exist on the
// submodule's origin. A pin already there needs nothing; otherwise exactly the pinned commit
// is pushed, as a fast-forward of the submodule's branch, so nothing past the pin ever goes.
export function pushPins(
  root: string,
  upstream: string,
  tip: string,
  report: Reporter,
): boolean {
  for (const [path, pin] of pins(root, upstream, tip)) {
    const dir = join(root, path);
    const short = pin.slice(0, 10);
    if (!existsSync(join(dir, ".git"))) {
      report.warn(
        `${path}: not checked out here, so ${short} cannot be pushed`,
      );
      return false;
    }
    git(dir, ["fetch", "-q", "origin"]);
    if (gitText(dir, ["branch", "-r", "--contains", pin]) !== "") {
      report.info(`${path}: ${short} is already on its origin`);
      continue;
    }
    if (!gitOk(dir, ["cat-file", "-e", `${pin}^{commit}`])) {
      report.warn(`${path}: ${short} is neither here nor on its origin`);
      return false;
    }
    const branch = branchOf(root, path);
    const remote = `origin/${branch}`;
    if (
      gitOk(dir, ["rev-parse", "-q", "--verify", remote]) &&
      !gitOk(dir, ["merge-base", "--is-ancestor", remote, pin])
    ) {
      report.warn(
        `${path}: ${remote} moved past what ${short} builds on; rebase the submodule change and pin it again`,
      );
      return false;
    }
    const pushed = git(dir, [
      "push",
      "-q",
      "origin",
      `${pin}:refs/heads/${branch}`,
    ]);
    if (pushed.status !== 0) {
      report.warn(`${path}: pushing ${short} failed:\n${pushed.stderr.trim()}`);
      return false;
    }
    report.info(`${path}: pushed ${short} to ${remote}`);
  }
  return true;
}
