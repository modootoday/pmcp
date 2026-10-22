import { ConfigError, type ProjectConfig } from "../config.js";
import { expandPath } from "../sessions/paths.js";
import { child, Reader, table } from "./config/reader.js";
import {
  deliver,
  gate,
  leases,
  mainlineSync,
  submodules,
  worktreeSync,
  worktrees,
} from "./config/tables.js";
import type { GitConfig } from "./types.js";

function umask(path: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^0?[0-7]{3}$/u.test(value))
    throw new ConfigError(
      path,
      `[git] umask must be an octal string such as "022", not ${JSON.stringify(value)}`,
    );
  return Number.parseInt(value, 8);
}

function enabled(path: string, value: unknown): "auto" | boolean {
  if (value === undefined || value === "auto") return "auto";
  if (typeof value === "boolean") return value;
  throw new ConfigError(path, "[git] enabled must be auto, true or false");
}

// Read the branch from its table because TOML cannot combine a scalar mainline with child tables.
export function readGitConfig(config: ProjectConfig): GitConfig | null {
  const { path, dir, raw } = config;
  const root = table(path, "git", raw["git"]);
  if (root === undefined) return null;
  const on = enabled(path, root["enabled"]);
  if (on === false) return null;
  const read = new Reader(path, "git", root, [
    "enabled",
    "remote",
    "mainline",
    "worktrees",
    "shared_checkout",
    "submodules",
    "umask",
  ]);
  const worktreeTable = child(path, root, "git", "worktrees");
  const named = typeof root["mainline"] === "string";
  const mainline = named ? undefined : child(path, root, "git", "mainline");
  const branch =
    mainline &&
    new Reader(path, "git.mainline", mainline, [
      "branch",
      "gate",
      "deliver",
      "sync",
    ]).string("branch");
  const sessions = table(path, "sessions", raw["sessions"]);
  const syncTable = child(path, worktreeTable, "git.worktrees", "sync");
  const gateTable = child(path, mainline, "git.mainline", "gate");
  const deliverTable = child(path, mainline, "git.mainline", "deliver");
  const mainSyncTable = child(path, mainline, "git.mainline", "sync");
  const submoduleTable = child(path, root, "git", "submodules");
  const stateDir = sessions?.["state_dir"];
  return {
    enabled: on,
    remote: read.string("remote"),
    mainline: named ? read.string("mainline") : branch,
    worktrees: worktreeTable && worktrees(path, worktreeTable),
    worktreeSync: syncTable && worktreeSync(path, syncTable),
    gate: gateTable && gate(path, dir, gateTable),
    deliver: deliverTable && deliver(path, deliverTable),
    sync: mainSyncTable && mainlineSync(path, mainSyncTable),
    submodules: submoduleTable && submodules(path, submoduleTable),
    stateDir:
      typeof stateDir === "string" ? expandPath(dir, stateDir) : undefined,
    leases: leases(path, sessions),
    ...(root["umask"] !== undefined
      ? { umask: umask(path, root["umask"]) }
      : {}),
  };
}
