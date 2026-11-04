import { realSteps, shellCall } from "../_shared.js";
import { startsWith } from "../sessions/leases.js";
import { onlyKeys, pass, type Policy } from "../types.js";

export interface HeavyOptions {
  readonly heavy: readonly (readonly string[])[];
  // A step that assigns one of these names (the documented opt-out) runs unleased on purpose.
  readonly skipEnv: readonly string[];
}

function argvList(value: unknown): string[][] {
  const valid =
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length > 0 &&
        item.every((word) => typeof word === "string" && word !== ""),
    );
  if (!valid) throw new Error("heavy must be a list of argv prefixes");
  return value as string[][];
}

function names(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
    throw new Error("skip_env must be a list of names");
  return value as string[];
}

// A wrapped command (pmcp heavy -- ...) starts with the wrapper, so it never matches a prefix.
export const hostLease: Policy<HeavyOptions> = {
  id: "host.lease",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "open",
  defaultMode: "observe",
  options(raw) {
    onlyKeys(raw, ["heavy", "skip_env"]);
    return { heavy: argvList(raw["heavy"]), skipEnv: names(raw["skip_env"]) };
  },
  evaluate(input, ctx) {
    const call = shellCall(input);
    if (!call) return pass;
    for (const step of realSteps(call.steps)) {
      if (!ctx.options.heavy.some((prefix) => startsWith(step.argv, prefix)))
        continue;
      if (step.assigned.some((name) => ctx.options.skipEnv.includes(name)))
        continue;
      return {
        verdict: "deny",
        reason: `${step.argv.join(" ")} is a heavy command ([host.lease] heavy) and runs outside the host lease. Run it as: pmcp heavy -- ${step.argv.join(" ")}`,
      };
    }
    return pass;
  },
};
