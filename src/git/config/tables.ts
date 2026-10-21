import { ConfigError } from "../../config.js";
import type {
  DeliverConfig,
  GateConfig,
  LeaseSpec,
  MainlineSyncConfig,
  SubmodulesConfig,
  WorktreeSyncConfig,
  WorktreesConfig,
} from "../types.js";
import { expandPath } from "../../sessions/paths.js";
import { child, Reader, table, type Table } from "./reader.js";

export function worktrees(path: string, source: Table): WorktreesConfig {
  const read = new Reader(path, "git.worktrees", source, [
    "root",
    "branch_prefix",
    "alias_pattern",
    "bootstrap",
    "link_from_main",
    "sync",
  ]);
  const pattern = read.string("alias_pattern") ?? "^[a-z][a-z0-9-]{1,30}$";
  try {
    new RegExp(pattern, "u");
  } catch {
    throw new ConfigError(
      path,
      "[git.worktrees] alias_pattern is not a valid regular expression",
    );
  }
  return {
    root: read.string("root") ?? ".claude/worktrees",
    branchPrefix: read.string("branch_prefix") ?? "worktree-",
    aliasPattern: pattern,
    bootstrap: read.argv("bootstrap"),
    linkFromMain: read.list("link_from_main"),
  };
}

export function worktreeSync(path: string, source: Table): WorktreeSyncConfig {
  const read = new Reader(path, "git.worktrees.sync", source, [
    "on_session_start",
    "install_after_move",
    "between_prompts",
    "notice_paths",
  ]);
  return {
    onSessionStart: read.string("on_session_start") ?? "fetch_and_move",
    installAfterMove: read.oneOf(
      "install_after_move",
      ["background", "foreground", "off"],
      "off",
    ),
    betweenPrompts: read.string("between_prompts") ?? "move_if_light",
    noticePaths: read.list("notice_paths"),
  };
}

export function gate(path: string, dir: string, source: Table): GateConfig {
  const read = new Reader(path, "git.mainline.gate", source, [
    "command",
    "tree",
    "lock_wait_seconds",
    "lock_env",
    "tree_env",
    "log_dir",
  ]);
  const tree = read.string("tree");
  const lockEnv = read.envName("lock_env");
  const treeEnv = read.envName("tree_env");
  const logDir = read.string("log_dir");
  return {
    command: read.argv("command"),
    tree: tree === undefined ? undefined : expandPath(dir, tree),
    lockWaitSeconds: read.int("lock_wait_seconds", 5400),
    ...(lockEnv ? { lockEnv } : {}),
    ...(treeEnv ? { treeEnv } : {}),
    ...(logDir ? { logDir: expandPath(dir, logDir) } : {}),
  };
}

export function deliver(path: string, source: Table): DeliverConfig {
  const read = new Reader(path, "git.mainline.deliver", source, [
    "attempts",
    "refuse_direct_push",
    "during_pause",
    "lease_wait_seconds",
    "notify",
  ]);
  return {
    attempts: read.int("attempts", 3),
    refuseDirectPush: read.bool("refuse_direct_push", true),
    duringPause: read.oneOf("during_pause", ["refuse", "allow"], "refuse"),
    leaseWaitSeconds: read.int("lease_wait_seconds", 3600),
    notify: read.argv("notify"),
  };
}

export function mainlineSync(path: string, source: Table): MainlineSyncConfig {
  const read = new Reader(path, "git.mainline.sync", source, [
    "install",
    "install_when_changed",
    "keep_identical_files",
    "refuse_with_unlanded",
  ]);
  return {
    install: read.argv("install"),
    installWhenChanged: read.list("install_when_changed"),
    keepIdenticalFiles: read.bool("keep_identical_files", true),
    refuseWithUnlanded: read.bool("refuse_with_unlanded", true),
  };
}

export function submodules(path: string, source: Table): SubmodulesConfig {
  const read = new Reader(path, "git.submodules", source, ["follow"]);
  return { follow: read.oneOf("follow", ["clean_pins", "off"], "clean_pins") };
}

export function leases(path: string, sessions: Table | undefined): LeaseSpec[] {
  const declared = child(path, sessions, "sessions", "leases");
  if (declared === undefined) return [];
  return Object.keys(declared).map((name) => {
    const spec = table(path, `sessions.leases.${name}`, declared[name]) ?? {};
    const value = spec["path"];
    const paths = typeof value === "string" ? [value] : [];
    return { name, paths };
  });
}
