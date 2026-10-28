import { join, resolve } from "node:path";

import { LOCK_FILE } from "../compiled.js";
import type { HookInput, NeutralEvent } from "../contract.js";
import type { RuntimeAdapter } from "../runtimes/types.js";
import { failClosed } from "./fail-closed.js";

const REV = String.raw`[\w./~^@{}-]+`;
const LOCK = String.raw`(?:\./)?pmcp\.lock`;
// Commands that only put pmcp.lock back from git: one step, nothing else written.
const REPAIRS = [
  new RegExp(String.raw`^git show ${REV}:${LOCK} > ${LOCK}$`, "u"),
  new RegExp(
    String.raw`^git checkout (?:(?:--ours|--theirs|${REV}) )?(?:-- )?${LOCK}$`,
    "u",
  ),
  new RegExp(
    String.raw`^git restore (?:(?:--source=${REV}|--staged|--worktree|--ours|--theirs|-[SW]+) )*(?:-- )?${LOCK}$`,
    "u",
  ),
];

// What may run while pmcp.lock is unreadable: a read, an edit of pmcp.lock alone, or a command
// that restores it from git. Everything else waits, since no guard can be verified.
export function repairsLock(input: HookInput, root: string): boolean {
  const tool = input.tool;
  if (!tool) return false;
  if (tool.kind === "read") return true;
  if (tool.kind === "edit") {
    const lock = join(root, LOCK_FILE);
    return (
      tool.paths.length > 0 &&
      tool.paths.every((path) => resolve(input.cwd, path) === lock)
    );
  }
  if (tool.kind === "shell") {
    const command = (tool.command ?? "").trim().replace(/\s+/gu, " ");
    return REPAIRS.some((pattern) => pattern.test(command));
  }
  return false;
}

export function lockRepair(
  adapter: RuntimeAdapter,
  event: NeutralEvent,
  root: string,
  input: HookInput | null,
  error: Error,
): string {
  if (event !== "before_tool") return "";
  if (input && repairsLock(input, root))
    return adapter.render(input, {
      context: [
        `pmcp hooks: ${error.message}; this call repairs it, so it passes`,
      ],
    }).stdout;
  return failClosed(adapter, event, root, error);
}
