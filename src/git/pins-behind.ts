import { existsSync } from "node:fs";
import { join } from "node:path";

import { git, gitOk, gitText } from "./exec.js";

const TREE_GITLINK = /^160000 commit ([0-9a-f]{40})\t(.+)$/u;

export interface PinsBehind {
  // Behind for a reason sync honours on purpose: local work or an origin it cannot read.
  readonly held: readonly string[];
  // Behind with no such reason: git refused the move, so the tree is not what HEAD names.
  readonly refused: readonly string[];
}

function holdReason(dir: string, shared: boolean): string | null {
  const dirty = git(dir, ["status", "--porcelain"]).stdout.trim() !== "";
  if (dirty && shared) return "its local edits conflict with the pin";
  if (dirty) return "it has uncommitted changes";
  if (!gitText(dir, ["for-each-ref", "--count=1", "refs/remotes"]))
    return "what its origin holds is unknown (no remote-tracking refs)";
  return null;
}

// Only a checkout behind its HEAD pin counts; one ahead of or beside it holds its own work.
export function gitlinksBehindPins(
  root: string,
  shared: readonly string[] = [],
): PinsBehind {
  const held: string[] = [];
  const refused: string[] = [];
  const tree = gitText(root, ["ls-tree", "-r", "HEAD"]);
  for (const entry of tree.split("\n")) {
    const match = TREE_GITLINK.exec(entry);
    if (!match) continue;
    const [, pin = "", path = ""] = match;
    const dir = join(root, path);
    if (!existsSync(join(dir, ".git"))) continue;
    const head = gitText(dir, ["rev-parse", "HEAD"]);
    if (head === pin) continue;
    const known = gitOk(dir, ["cat-file", "-e", `${pin}^{commit}`]);
    if (known && !gitOk(dir, ["merge-base", "--is-ancestor", head, pin]))
      continue;
    const where = `at ${head.slice(0, 10)}, behind its pin ${pin.slice(0, 10)}`;
    const reason = holdReason(dir, shared.includes(path));
    if (reason !== null) {
      held.push(`${path}: held ${where}: ${reason}`);
      continue;
    }
    const missing = known ? "" : " (the pin is not in its checkout)";
    refused.push(`${path}: ${where}${missing}, with no reason to hold it`);
  }
  return { held, refused };
}

function heldCount(count: number): string {
  if (count === 1) return "1 gitlink held behind its pin";
  return `${count} gitlinks held behind their pins`;
}

// Held checkouts are reported and leave the exit code alone; refused ones fail the sync.
export function reportPinsBehind(
  root: string,
  shared: readonly string[],
  report: { info(line: string): void; warn(line: string): void },
): boolean {
  const { held, refused } = gitlinksBehindPins(root, shared);
  for (const line of held) report.info(line);
  if (held.length > 0) report.info(heldCount(held.length));
  for (const line of refused) report.warn(line);
  return refused.length === 0;
}
