import { dirname, join } from "node:path";
import type { ProjectConfig } from "../config.js";
import { readLoggingTable } from "../logging/settings.js";
import { expandPath } from "../sessions/paths.js";
import { readStoreSettings } from "../sessions/settings.js";
import { projectStateDir } from "../sessions/state-dir.js";

export function logLocation(
  config: ProjectConfig,
  env: Readonly<Record<string, string | undefined>>,
) {
  const hooks = (config.raw.hooks ?? {}) as Record<string, unknown>;
  const keepDays = readLoggingTable(config.raw.logging).keepDays;
  if (typeof hooks.error_log === "string") {
    const file = expandPath(config.dir, hooks.error_log);
    return { dir: dirname(file), file, keepDays };
  }
  const settings = readStoreSettings(config.raw.sessions);
  return {
    dir: join(projectStateDir(config.dir, settings.stateDir, env), "logs"),
    keepDays,
  };
}
