import { isAbsolute } from "node:path";
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
    "desks",
  ]);
  const pattern = read.string("alias_pattern") ?? "^[a-z][a-z0-9-]{1,30}$";
  const root = read.string("root") ?? ".claude/worktrees";
  try {
    new RegExp(pattern, "u");
  } catch {
    throw new ConfigError(
      path,
      "[git.worktrees] alias_pattern is not a valid regular expression",
    );
  }
  return {
    root,
    branchPrefix: read.string("branch_prefix") ?? "worktree-",
    aliasPattern: pattern,
    bootstrap: read.argv("bootstrap"),
    linkFromMain: read.list("link_from_main"),
    desks: read.string("desks") ?? `${root.replace(/\/+$/u, "")}/*`,
  };
}

export function worktreeSync(path: string, source: Table): WorktreeSyncConfig {
  const read = new Reader(path, "git.worktrees.sync", source, [
    "on_session_start",
    "install_after_move",
    "between_prompts",
    "notice_paths",
    "after_deliver",
  ]);
  return {
    afterDeliver: read.oneOf<"desk" | "off">(
      "after_deliver",
      ["desk", "off"],
      "off",
    ),
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
    "max_load",
    "load_wait_seconds",
  ]);
  const tree = read.string("tree");
  const lockEnv = read.envName("lock_env");
  const treeEnv = read.envName("tree_env");
  const logDir = read.string("log_dir");
  const maxLoad = read.positive("max_load");
  return {
    command: read.argv("command"),
    tree: tree === undefined ? undefined : expandPath(dir, tree),
    lockWaitSeconds: read.int("lock_wait_seconds", 5400),
    loadWaitSeconds: read.int("load_wait_seconds", 1800),
    ...(maxLoad ? { maxLoad } : {}),
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
    "gate",
    "push_env",
  ]);
  return {
    attempts: read.int("attempts", 3),
    refuseDirectPush: read.bool("refuse_direct_push", true),
    duringPause: read.oneOf("during_pause", ["refuse", "allow"], "refuse"),
    leaseWaitSeconds: read.int("lease_wait_seconds", 3600),
    notify: read.argv("notify"),
    gate: read.oneOf("gate", ["command", "pre-push"], "command"),
    pushEnv: read.envMap("push_env"),
  };
}

export function mainlineSync(path: string, source: Table): MainlineSyncConfig {
  const read = new Reader(path, "git.mainline.sync", source, [
    "install",
    "install_when_changed",
    "keep_identical_files",
    "refuse_with_unlanded",
    "stamp",
    "stamp_hash",
    "after_deliver",
  ]);
  const installWhenChanged = read.list("install_when_changed");
  const stamp = read.string("stamp");
  const hash = read.oneOf("stamp_hash", ["pmcp", "plain"], "pmcp");
  if (stamp !== undefined) {
    const home = stamp.startsWith("~/") || stamp.startsWith("$HOME/");
    if (!stamp.startsWith("${git_dir}/") && !home && !isAbsolute(stamp))
      throw new ConfigError(
        path,
        "[git.mainline.sync] stamp must start with ${git_dir}/, ~/ or /",
      );
    if (hash === "plain" && installWhenChanged.length !== 1)
      throw new ConfigError(
        path,
        '[git.mainline.sync] stamp_hash = "plain" needs exactly one install_when_changed path',
      );
  }
  return {
    install: read.argv("install"),
    installWhenChanged,
    keepIdenticalFiles: read.bool("keep_identical_files", true),
    refuseWithUnlanded: read.bool("refuse_with_unlanded", true),
    afterDeliver: read.oneOf<"from_main" | "always" | "off">(
      "after_deliver",
      ["from_main", "always", "off"],
      "from_main",
    ),
    ...(stamp !== undefined
      ? {
          stamp: {
            path: stamp.startsWith("${git_dir}/")
              ? stamp
              : expandPath("/", stamp),
            hash,
          },
        }
      : {}),
  };
}

export function submodules(path: string, source: Table): SubmodulesConfig {
  const read = new Reader(path, "git.submodules", source, [
    "follow",
    "shared",
    "push",
  ]);
  return {
    follow: read.oneOf("follow", ["clean_pins", "off"], "clean_pins"),
    shared: read.list("shared"),
    push: read.oneOf("push", ["pins", "off"], "off"),
  };
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
