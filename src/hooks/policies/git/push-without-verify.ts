import type { ShellStep } from "../../contract.js";
import { gitCall } from "../../shell/classify.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

const REASON =
  "Pushing with verification disabled skips every pre-push check at once, including the ones that catch what a person cannot review by eye. Fix the failing check instead of waiving all of them.";

// Git reads these as configuration for the one command, so they can point core.hooksPath away.
const CONFIG_ENV = new Set(["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"]);

function namesHooksPath(entry: string | undefined): boolean {
  return (entry ?? "").split("=")[0]!.toLowerCase() === "core.hookspath";
}

// Global options before the subcommand that set core.hooksPath for this command.
function overridesHooks(argv: readonly string[], at: number): boolean {
  for (let index = 1; index < at; index += 1) {
    const word = argv[index]!;
    if (word === "-c" || word === "--config-env") {
      if (namesHooksPath(argv[index + 1])) return true;
      index += 1;
    } else if (word.startsWith("--config-env=")) {
      if (namesHooksPath(word.slice("--config-env=".length))) return true;
    }
  }
  return false;
}

// --no-verify has no short form on push: -n there is --dry-run, which sends nothing.
function skipsVerify(step: ShellStep): boolean {
  const { argv } = step;
  if (program(argv[0]) !== "git") return false;
  const call = gitCall(argv);
  if (call.sub !== "push") return false;
  return (
    argv.slice(call.at + 1).includes("--no-verify") ||
    overridesHooks(argv, call.at) ||
    step.assigned.some((name) => CONFIG_ENV.has(name))
  );
}

export const pushWithoutVerify: Policy<object> = {
  id: "git.push_without_verify",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input) {
    const call = shellCall(input);
    if (!call) return pass;
    const hit = realSteps(call.steps).some(skipsVerify);
    return hit ? { verdict: "deny", reason: REASON } : pass;
  },
};
