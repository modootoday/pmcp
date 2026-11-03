import { join, resolve } from "node:path";

import { LOCK_FILE } from "../compiled.js";
import type { HookInput, NeutralEvent, ShellStep } from "../contract.js";
import type { RuntimeAdapter } from "../runtimes/types.js";
import { readScript } from "../shell/classify.js";
import { failClosed } from "./fail-closed.js";

const REV = /^[\w./~^@{}][\w./~^@{}-]*$/u;
const LOCK_PATHS = new Set([LOCK_FILE, `./${LOCK_FILE}`]);
const RESTORE_OPTIONS = new Set([
  "--staged",
  "--worktree",
  "--ours",
  "--theirs",
]);

const isLock = (word: string | undefined) =>
  word !== undefined && LOCK_PATHS.has(word);

// git show <rev>:pmcp.lock > pmcp.lock, and nothing else on the line.
function showsLock(args: readonly string[], step: ShellStep): boolean {
  const [spec, ...rest] = args;
  const colon = spec?.indexOf(":") ?? -1;
  const [into, ...more] = step.redirects;
  return (
    rest.length === 0 &&
    colon > 0 &&
    REV.test(spec!.slice(0, colon)) &&
    isLock(spec!.slice(colon + 1)) &&
    more.length === 0 &&
    into?.op === ">" &&
    into.fd === "" &&
    isLock(into.target)
  );
}

// git checkout [--ours|--theirs|<rev>] [--] pmcp.lock, or git restore with its source and side options.
function checksOutLock(sub: string, args: readonly string[]): boolean {
  if (!isLock(args.at(-1))) return false;
  let options = args.slice(0, -1);
  if (options.at(-1) === "--") options = options.slice(0, -1);
  if (sub === "checkout")
    return (
      options.length === 0 ||
      (options.length === 1 &&
        (options[0] === "--ours" ||
          options[0] === "--theirs" ||
          REV.test(options[0]!)))
    );
  if (sub === "restore")
    return options.every(
      (option) =>
        RESTORE_OPTIONS.has(option) ||
        /^-[SW]+$/u.test(option) ||
        (option.startsWith("--source=") &&
          REV.test(option.slice("--source=".length))),
    );
  return false;
}

// One git step that only puts pmcp.lock back from git.
function restoresLock(command: string): boolean {
  const read = readScript(command);
  if ("error" in read || read.steps.length !== 1) return false;
  const step = read.steps[0]!;
  if (
    step.assigned.length > 0 ||
    read.redirects.length !== step.redirects.length
  )
    return false;
  const [git, sub = "", ...args] = step.argv;
  if (git !== "git") return false;
  if (sub === "show") return showsLock(args, step);
  return step.redirects.length === 0 && checksOutLock(sub, args);
}

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
  if (tool.kind === "shell") return restoresLock(tool.command ?? "");
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
