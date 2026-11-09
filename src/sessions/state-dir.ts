import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { gitCommonDir } from "./checkout.js";
import { expandPath } from "./paths.js";

function stateHome(env: Readonly<Record<string, string | undefined>>): string {
  return env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
}

// One id per repository, so every worktree of it shares the same directories.
export function projectStateId(root: string): string {
  const anchor = gitCommonDir(root) ?? realpathSync(root);
  return createHash("sha256").update(anchor).digest("hex").slice(0, 16);
}

// Share state across worktrees because they coordinate through one repository.
export function projectStateDir(
  root: string,
  override?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (override) return expandPath(root, override);
  return join(stateHome(env), "pmcp", "projects", projectStateId(root));
}

// Files moved out of a checkout, kept where no checkout, clean or full-tree scan reaches them.
export function displacedDir(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(stateHome(env), "pmcp", "displaced", projectStateId(root));
}
