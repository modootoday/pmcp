import { existsSync } from "node:fs";
import { join } from "node:path";

import { gitOk, gitText } from "./exec.js";

const TREE_GITLINK = /^160000 commit ([0-9a-f]{40})\t(.+)$/u;

// A checkout still behind its HEAD pin after a move makes every later read of the tree wrong
// (an install regenerates a lock file from old manifests), so a sync that leaves one fails.
// One ahead of or beside its pin holds its own work and is not counted.
export function gitlinksBehindPins(root: string): string[] {
  const lines: string[] = [];
  const tree = gitText(root, ["ls-tree", "-r", "HEAD"]);
  for (const entry of tree.split("\n")) {
    const match = TREE_GITLINK.exec(entry);
    if (!match) continue;
    const [, pin = "", path = ""] = match;
    const dir = join(root, path);
    if (!existsSync(join(dir, ".git"))) continue;
    const head = gitText(dir, ["rev-parse", "HEAD"]);
    if (head === pin) continue;
    if (!gitOk(dir, ["cat-file", "-e", `${pin}^{commit}`])) {
      lines.push(
        `${path}: at ${head.slice(0, 10)}, and its pin ${pin.slice(0, 10)} is not in its checkout`,
      );
      continue;
    }
    if (!gitOk(dir, ["merge-base", "--is-ancestor", head, pin])) continue;
    lines.push(
      `${path}: at ${head.slice(0, 10)}, behind its pin ${pin.slice(0, 10)}`,
    );
  }
  return lines;
}
