import { existsSync } from "node:fs";
import { join } from "node:path";

import { gitOk, gitText } from "./exec.js";
import { fetchedPin, followOne } from "./submodules.js";

const INDEX_GITLINK = /^160000 ([0-9a-f]{40}) 0\t(.+)$/u;

// A checkout behind its HEAD pin was left there by a move pmcp did not make (a rebase, a
// reset), so it follows as if the pin had just changed. One ahead of or beside its pin, or
// whose pin move is staged, is work in progress and stays where it is.
export function followLaggingPins(
  root: string,
  shared: readonly string[] = [],
): string[] {
  const lines: string[] = [];
  for (const entry of gitText(root, ["ls-files", "-s"]).split("\n")) {
    const match = INDEX_GITLINK.exec(entry);
    if (!match) continue;
    const [, staged = "", path = ""] = match;
    const pin = gitText(root, ["rev-parse", "-q", "--verify", `HEAD:${path}`]);
    if (pin !== staged) continue;
    const dir = join(root, path);
    if (!existsSync(join(dir, ".git"))) continue;
    const head = gitText(dir, ["rev-parse", "HEAD"]);
    if (head === pin || !fetchedPin(dir, pin)) continue;
    if (!gitOk(dir, ["merge-base", "--is-ancestor", head, pin])) continue;
    lines.push(
      `${path}: behind its pin; ${followOne(dir, head, pin, shared.includes(path))}`,
    );
  }
  return lines;
}
