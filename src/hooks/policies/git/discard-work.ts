import { resolve } from "node:path";

import { gitCall } from "../../shell/classify.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type GitProbe, type Policy } from "../types.js";

const STASH_READS = new Set(["list", "show"]);
const STASH_SHARED =
  ", and the stash is shared by every worktree of this repository";

function shortFlag(args: readonly string[], letter: string): boolean {
  return args.some((arg) => /^-[a-zA-Z]+$/u.test(arg) && arg.includes(letter));
}

function checkoutDiscards(args: readonly string[]): boolean {
  if (args.includes("-f") || args.includes("--force")) return true;
  const paths = args.indexOf("--");
  if (paths >= 0) return paths < args.length - 1;
  return args.filter((arg) => !arg.startsWith("-")).includes(".");
}

function restoreDiscards(args: readonly string[]): boolean {
  const staged = args.includes("--staged") || shortFlag(args, "S");
  const worktree = args.includes("--worktree") || shortFlag(args, "W");
  return worktree || !staged;
}

// The git command that throws away uncommitted work or the shared stash, if this is one.
export function discardingCommand(argv: readonly string[]): {
  command: string;
  dir: string;
} | null {
  if (program(argv[0]) !== "git") return null;
  const call = gitCall(argv);
  const args = argv.slice(call.at + 1);
  const named = (command: string) => ({ command, dir: call.dir });
  if (call.sub === "reset" && args.includes("--hard"))
    return named("git reset --hard");
  if (call.sub === "checkout" && checkoutDiscards(args))
    return named("git checkout of paths");
  if (call.sub === "restore" && restoreDiscards(args))
    return named("git restore of the working tree");
  if (
    call.sub === "clean" &&
    (args.includes("--force") || shortFlag(args, "f"))
  )
    return named("git clean -f");
  if (call.sub === "stash" && !STASH_READS.has(call.next))
    return named("git stash");
  return null;
}

type Place = "own" | "shared" | "other";

// A checkout with linked worktrees is shared by the sessions that work beside it; the session's
// own linked worktree is its desk, and any other worktree belongs to someone else.
function placeOf(
  git: GitProbe,
  sessionCwd: string,
  target: string,
): Place | null {
  const top = git.toplevel(target);
  if (!top) return null;
  const trees = git.worktrees(target);
  if (trees.length < 2) return "own";
  if (top === trees[0]?.path) return "shared";
  return top === git.toplevel(sessionCwd) ? "own" : "other";
}

const WHERE: Readonly<Record<Exclude<Place, "own">, string>> = {
  shared: "the shared checkout, which other sessions read and land from",
  other: "another session's worktree",
};

export const discardWork: Policy<object> = {
  id: "git.discard_work",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "graded",
  options: noOptions,
  evaluate(input, ctx) {
    const call = shellCall(input);
    if (!call) return pass;
    for (const step of realSteps(call.steps)) {
      const found = discardingCommand(step.argv);
      if (!found) continue;
      const target = resolve(input.cwd, step.dir, found.dir);
      const place = placeOf(ctx.git, input.cwd, target);
      if (!place) continue;
      if (place === "own") {
        const shared = found.command === "git stash" ? STASH_SHARED : "";
        return {
          context: [
            `pmcp git.discard_work: ${found.command} throws away uncommitted work in this worktree; commit it first, or name the paths you mean${shared}.`,
          ],
        };
      }
      return {
        verdict: "deny",
        reason: `${found.command} in ${WHERE[place]} throws away work that is not yours. Work in your own worktree, or ask its owner.`,
      };
    }
    return pass;
  },
};
