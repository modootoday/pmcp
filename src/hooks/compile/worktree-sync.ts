import type { ProjectConfig } from "../../config.js";
import { readGitConfig } from "../../git/config.js";
import { leaseSpecs } from "../../git/setup.js";
import type { CompiledGuard } from "../compiled.js";
import type { WorktreeSyncOptions } from "../policies/workspace/worktree-sync.js";

const SESSION_START = ["fetch_and_move", "move", "off"];
const BETWEEN_PROMPTS = ["move_if_light", "off"];

// Use the git reader so hooks and worktree commands interpret synchronization settings consistently.
export function readWorktreeSync(
  tables: { readonly git?: unknown; readonly sessions?: unknown },
  root: string,
): CompiledGuard | null {
  if (tables.git === undefined) return null;
  const config = {
    path: "pmcp.toml",
    dir: root,
    raw: { git: tables.git, sessions: tables.sessions },
  } as unknown as ProjectConfig;
  const git = readGitConfig(config);
  const sync = git?.worktreeSync;
  if (!git || !sync) return null;
  if (!SESSION_START.includes(sync.onSessionStart)) {
    throw new Error(
      `[git.worktrees.sync] on_session_start must be one of ${SESSION_START.join(", ")}`,
    );
  }
  if (!BETWEEN_PROMPTS.includes(sync.betweenPrompts)) {
    throw new Error(
      `[git.worktrees.sync] between_prompts must be one of ${BETWEEN_PROMPTS.join(", ")}`,
    );
  }
  const options: WorktreeSyncOptions = {
    root: git.worktrees?.root ?? ".claude/worktrees",
    ...(git.remote ? { remote: git.remote } : {}),
    ...(git.mainline ? { mainline: git.mainline } : {}),
    onSessionStart:
      sync.onSessionStart as WorktreeSyncOptions["onSessionStart"],
    betweenPrompts:
      sync.betweenPrompts as WorktreeSyncOptions["betweenPrompts"],
    installAfterMove: sync.installAfterMove,
    ...(git.sync?.install ? { install: git.sync.install } : {}),
    installWhen: git.sync?.installWhenChanged ?? [],
    noticePaths: sync.noticePaths,
    followSubmodules: git.submodules?.follow === "clean_pins",
    leases: leaseSpecs(git).map((spec) => spec.name),
    ...(git.umask !== undefined ? { umask: git.umask } : {}),
  };
  return {
    id: "git.worktrees.sync",
    mode: "warn",
    options: options as unknown as Record<string, unknown>,
  };
}
