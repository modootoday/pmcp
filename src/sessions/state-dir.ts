import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { gitCommonDir } from "./checkout.js";
import { expandPath } from "./paths.js";

// Share state across worktrees because they coordinate through one repository.
export function projectStateDir(
  root: string,
  override?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (override) return expandPath(root, override);
  const anchor = gitCommonDir(root) ?? realpathSync(root);
  const id = createHash("sha256").update(anchor).digest("hex").slice(0, 16);
  const base = env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(base, "pmcp", "projects", id);
}
