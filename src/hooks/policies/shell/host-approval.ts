import type { HookInput } from "../../contract.js";
import { realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

// Approving the pmcp-pty host policy is the operator's act. Every session runs as the same
// user, so this is a speed bump against an agent told to approve, not a security boundary.
const APPROVALS = "host-approvals";
const VERB = ["host", "approve"];
const FALLBACK = /\bhost\s+approve\b|host-approvals/u;
const REASON =
  "Approving the pmcp-pty host policy is the operator's step: run pmcp harness host approve in your own terminal, not from an agent.";

function approves(argv: readonly string[]): boolean {
  const at = argv.indexOf(VERB[0]!);
  return at >= 0 && argv[at + 1] === VERB[1];
}

function hit(input: HookInput): boolean {
  const tool = input.tool;
  if (tool?.kind === "edit")
    return tool.paths.some((path) => path.includes(`/${APPROVALS}`));
  const call = shellCall(input);
  if (!call) return false;
  if (!call.steps) return FALLBACK.test(call.command);
  return realSteps(call.steps).some(
    (step) =>
      approves(step.argv) || step.argv.some((word) => word.includes(APPROVALS)),
  );
}

export const hostApproval: Policy<object> = {
  id: "shell.host_approval",
  events: ["before_tool"],
  tools: ["shell", "edit"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input) {
    return hit(input) ? { verdict: "deny", reason: REASON } : pass;
  },
};
