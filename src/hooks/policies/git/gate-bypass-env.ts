import type { ShellStep } from "../../contract.js";
import { program, shellCall } from "../_shared.js";
import { onlyKeys, pass, stringList, type Policy } from "../types.js";

export interface BypassOptions {
  readonly variables: readonly string[];
  readonly noVerify: boolean;
}

const REASON =
  "This takes a way around the gate that only the operator may take. Fix what the gate reports, or ask the operator.";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// Match executed bypass assignments so searches and messages can safely mention their names.
function bypasses(step: ShellStep, options: BypassOptions): boolean {
  if (step.assigned.some((name) => options.variables.includes(name)))
    return true;
  const name = program(step.argv[0]);
  if (name === "export") {
    return step.argv.some((word) =>
      options.variables.includes(word.split("=")[0]!),
    );
  }
  return (
    options.noVerify && name === "git" && step.argv.includes("--no-verify")
  );
}

function fallback(command: string, options: BypassOptions): boolean {
  const names = options.variables.map(escape);
  if (options.noVerify) names.push("--no-verify");
  if (names.length === 0) return false;
  return new RegExp(`(?:^|[^\\w-])(?:${names.join("|")})\\b`, "u").test(
    command,
  );
}

export const gateBypassEnv: Policy<BypassOptions> = {
  id: "git.gate_bypass_env",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options(raw) {
    onlyKeys(raw, ["names", "no_verify"]);
    const noVerify = raw["no_verify"] ?? true;
    if (typeof noVerify !== "boolean")
      throw new Error("no_verify must be a boolean");
    return { variables: stringList(raw, "names") ?? [], noVerify };
  },
  evaluate(input, ctx) {
    const call = shellCall(input);
    if (!call) return pass;
    const hit = call.steps
      ? call.steps.some((step) => bypasses(step, ctx.options))
      : fallback(call.command, ctx.options);
    return hit ? { verdict: "deny", reason: REASON } : pass;
  },
};
