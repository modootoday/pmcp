import { gitCall } from "../../shell/classify.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

// --no-verify has no short form on push: -n there is --dry-run, which sends nothing.
const FALLBACK = /\bgit\b[^|;&\n]*\spush\b[^|;&\n]*\s--no-verify(?:\s|$)/u;
const REASON =
  "Pushing with verification disabled skips every pre-push check at once, including the ones that catch what a person cannot review by eye. Fix the failing check instead of waiving all of them.";

function skipsVerify(argv: readonly string[]): boolean {
  if (program(argv[0]) !== "git") return false;
  const call = gitCall(argv);
  if (call.sub !== "push") return false;
  return argv.slice(call.at + 1).includes("--no-verify");
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
    const hit = call.steps
      ? realSteps(call.steps).some((step) => skipsVerify(step.argv))
      : FALLBACK.test(call.command);
    return hit ? { verdict: "deny", reason: REASON } : pass;
  },
};
