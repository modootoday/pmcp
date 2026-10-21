import { resolve } from "node:path";

import { gitCall } from "../../shell/classify.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type GitProbe, type Policy } from "../types.js";

const FORCE = new Set(["-f", "-M", "--force"]);
const FALLBACK =
  /\bgit\b[^|;&\n]*\sbranch\b[^|;&\n]*\s(?:-f|-M|--force)(?:\s|$)/u;

export function forcedTarget(
  argv: readonly string[],
): { branch: string; dir: string } | null {
  if (program(argv[0]) !== "git") return null;
  const call = gitCall(argv);
  if (call.sub !== "branch") return null;
  const args = argv.slice(call.at + 1);
  if (!args.some((arg) => FORCE.has(arg))) return null;
  const branch = args.find((arg) => !arg.startsWith("-"));
  return branch ? { branch, dir: call.dir } : null;
}

function checkedOutElsewhere(
  git: GitProbe,
  cwd: string,
  branch: string,
): string | null {
  const here = git.toplevel(cwd);
  const other = git
    .worktrees(cwd)
    .find((tree) => tree.branch === branch && tree.path !== here);
  return other?.path ?? null;
}

export const forcedBranchMove: Policy<object> = {
  id: "git.forced_branch_move",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input, ctx) {
    const call = shellCall(input);
    if (!call) return pass;
    if (!call.steps) {
      if (!FALLBACK.test(call.command)) return pass;
      return {
        verdict: "deny",
        reason: "A forced branch move could not be read.",
      };
    }
    for (const step of realSteps(call.steps)) {
      const target = forcedTarget(step.argv);
      if (!target) continue;
      const cwd = resolve(input.cwd, step.dir, target.dir);
      if (!checkedOutElsewhere(ctx.git, cwd, target.branch)) continue;
      return {
        verdict: "deny",
        reason: `Branch ${target.branch} is checked out in another working tree. Moving it leaves that checkout's ref ahead of its files, so its status reports another session's work as deleted and committing removes it.`,
      };
    }
    return pass;
  },
};
