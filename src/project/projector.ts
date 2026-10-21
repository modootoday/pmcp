// Keep machine paths outside the lock so identical projects produce portable lock bytes.

import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { VERSION } from "../commands/version.js";
import { projectStateDir } from "../sessions/state-dir.js";
import type { ProjectSpec } from "./spec.js";
import { replaceFile } from "./write.js";

export const LOCK_VERSION_KEY = "pmcp_version";
export const PROJECTOR_FILE = "projector.json";

// Treat version differences as drift because different projectors may generate different outputs.
export function lockVersionProblem(root: string): string | null {
  const path = join(root, "pmcp.lock");
  if (!existsSync(path)) return null;
  const lock = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  const recorded = lock[LOCK_VERSION_KEY];
  if (recorded === VERSION) return null;
  return `drift: pmcp.lock ${LOCK_VERSION_KEY} ${typeof recorded === "string" ? recorded : "none"}, this pmcp ${VERSION}`;
}

// Record only a runnable published CLI because embedding callers may have no reusable executable.
const CLI_ENTRY = /[\\/]dist[\\/]cli\.js$/u;

export function recordProjector(
  spec: ProjectSpec,
  entry = process.argv[1],
): void {
  const policy = spec.hookBundle?.policy;
  if (!policy || !entry) return;
  try {
    const cli = realpathSync(entry);
    if (!CLI_ENTRY.test(cli)) return;
    const dir = projectStateDir(spec.root, policy.stateDir);
    const file = join(dir, PROJECTOR_FILE);
    const known = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
      : {};
    mkdirSync(dir, { recursive: true });
    replaceFile(
      file,
      `${JSON.stringify({ ...known, [realpathSync(spec.root)]: { cli, version: VERSION } }, null, 2)}\n`,
    );
  } catch {
    // The record only helps the stop check find a CLI; projection itself succeeded.
  }
}
