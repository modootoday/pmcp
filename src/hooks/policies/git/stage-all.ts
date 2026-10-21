import { gitCall } from "../../shell/classify.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

const ADD_VALUES = new Set(["--pathspec-from-file"]);
const COMMIT_VALUES = new Set([
  "--message",
  "--file",
  "--reuse-message",
  "--reedit-message",
  "--author",
  "--date",
  "--template",
  "--fixup",
  "--squash",
  "--trailer",
  "--cleanup",
  "--pathspec-from-file",
]);
const SHORT_VALUES = new Set(["m", "F", "C", "c", "t"]);
const ROOT_PATHS = new Set([".", "./", ":/", ":(top)", ":(top)."]);
const NAMES_GIT = /(?:^|[^\w.-])git(?![\w.-])/u;

function stagesAll(args: readonly string[], commit: boolean): boolean {
  let paths = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (paths) {
      if (!commit && ROOT_PATHS.has(arg)) return true;
      continue;
    }
    if (arg === "--") {
      paths = true;
      continue;
    }
    if (arg === "--all") return true;
    const values = commit ? COMMIT_VALUES : ADD_VALUES;
    if (values.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    if (!arg.startsWith("-")) {
      if (!commit && ROOT_PATHS.has(arg)) return true;
      continue;
    }
    for (let at = 1; at < arg.length; at += 1) {
      const flag = arg[at]!;
      if (flag === (commit ? "a" : "A")) return true;
      if (commit && SHORT_VALUES.has(flag)) {
        if (at === arg.length - 1) index += 1;
        break;
      }
    }
  }
  return false;
}

function stagesEverything(argv: readonly string[]): boolean {
  if (program(argv[0]) !== "git") return false;
  const call = gitCall(argv);
  if (call.sub !== "add" && call.sub !== "commit") return false;
  return stagesAll(argv.slice(call.at + 1), call.sub === "commit");
}

export const stageAll: Policy<object> = {
  id: "git.stage_all",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input) {
    const call = shellCall(input);
    if (!call) return pass;
    // A command that could not be parsed is refused only when it names git as a word.
    if (!call.steps && !NAMES_GIT.test(call.command)) return pass;
    if (
      call.steps &&
      !realSteps(call.steps).some((step) => stagesEverything(step.argv))
    )
      return pass;
    return {
      verdict: "deny",
      reason:
        "Stage explicit paths instead of staging everything; git.stage_all refuses this command.",
    };
  },
};
