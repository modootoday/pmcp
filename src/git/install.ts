import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runCommand } from "./exec.js";
import type { Argv, Reporter } from "./types.js";

export interface InstallSpec {
  readonly command: Argv;

  readonly when: readonly string[];

  readonly stateDir: string;
}

export function lockHash(
  root: string,
  paths: readonly string[],
): string | null {
  const hash = createHash("sha256");
  let found = false;
  for (const path of paths) {
    const file = join(root, path);
    if (!existsSync(file)) continue;
    found = true;
    hash.update(`${path}\0`).update(readFileSync(file));
  }
  if (!found) return null;
  return hash.digest("hex");
}

// Keep stamps per checkout because worktrees have independent installed packages.
export function stampFile(root: string, spec: InstallSpec): string {
  const key = createHash("sha256")
    .update([root, ...spec.when].join("\0"))
    .digest("hex");
  return join(spec.stateDir, "installed", key);
}

function readStamp(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

// Write stamps only after success so failed installs remain eligible for retry.
export function installIfStale(
  root: string,
  spec: InstallSpec,
  report: Reporter,
): number | null {
  const hash = lockHash(root, spec.when);
  const stamp = stampFile(root, spec);
  if (hash === null || readStamp(stamp) === hash) return null;
  report.info(
    `${spec.when.join(", ")} not installed here: ${spec.command.join(" ")}`,
  );
  const status = runCommand(spec.command, root);
  if (status !== 0) {
    report.warn(`the install exited ${status}; the next sync runs it again`);
    return status;
  }
  mkdirSync(join(spec.stateDir, "installed"), { recursive: true });
  writeFileSync(stamp, `${hash}\n`);
  return 0;
}
