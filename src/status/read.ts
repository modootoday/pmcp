import type { ProjectConfig } from "../config.js";
import { checkProject } from "../project/apply/check-project.js";
import { readSpec } from "../project/spec.js";
import { openStore, readStoreSettings } from "../sessions/settings.js";
import { sessionSnapshot } from "../sessions/snapshot.js";
import { authPresence } from "./auth.js";
import { recentErrors } from "./errors.js";
import { features } from "./features.js";
import { desks } from "./worktrees.js";

export async function readStatus(
  config: ProjectConfig,
  env: Readonly<Record<string, string | undefined>>,
) {
  const spec = readSpec(config);
  let checked;
  try {
    checked = checkProject(spec);
  } catch (error) {
    checked = {
      code: 2,
      outputs: 0,
      problems: [
        error instanceof Error ? error.message : "Projection check failed",
      ],
    };
  }
  const settings = readStoreSettings(config.raw.sessions, config.raw["git"]);
  const store = openStore(config.dir, settings, env);
  const sessions = (config.raw.sessions ?? {}) as Record<string, unknown>;
  const leases = Object.keys((sessions.leases ?? {}) as object);
  const worktrees = desks(config);
  const drift =
    checked.code !== 0 ||
    worktrees.some((row) => (row.behind ?? 0) > 0 || (row.ahead ?? 0) > 0);
  return {
    version: 1 as const,
    config: config.path,
    drift,
    features: features(config, spec),
    projection: {
      drift: checked.code !== 0,
      outputs: checked.outputs,
      problems: checked.problems,
    },
    sessions: sessionSnapshot(store, leases),
    worktrees,
    mcp: await authPresence(spec, env),
    errors: recentErrors(config, env),
  };
}
