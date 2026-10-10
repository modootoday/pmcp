import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { privateJson, readPrivateJson } from "../../harness/groups/store.js";
import { object, text } from "../../harness/validation.js";

export interface StartupState {
  schemaVersion: 1;
  projectRoot: string;
  phase: "creating" | "starting" | "view-pending" | "ready";
  runtime: string;
  groupFile?: string;
  generation?: string;
  viewFile?: string;
}

export function startupFile(projectRoot: string): string {
  const root = join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"),
    "pmcp/launcher",
  );
  const key = createHash("sha256").update(projectRoot).digest("hex");
  return join(root, `${key}.json`);
}

export function ensureStartupDirectory(file: string): void {
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("unsafe_startup_directory");
}

export function readStartup(
  file: string,
  projectRoot: string,
): StartupState | null {
  if (!existsSync(file)) return null;
  const value = object(readPrivateJson(file));
  if (value.schemaVersion !== 1 || value.projectRoot !== projectRoot)
    throw new Error("foreign_startup_state");
  if (
    !["creating", "starting", "view-pending", "ready"].includes(
      String(value.phase),
    )
  )
    throw new Error("invalid_startup_state");
  text(value.runtime, "runtime");
  if (value.phase !== "creating") {
    text(value.groupFile, "group_file");
    text(value.generation, "generation");
  }
  if (value.phase === "ready") text(value.viewFile, "view_file");
  return value as unknown as StartupState;
}

export function saveStartup(file: string, state: StartupState): void {
  privateJson(file, state);
}
