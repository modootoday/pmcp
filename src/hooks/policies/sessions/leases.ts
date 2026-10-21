import type { ShellStep } from "../../contract.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { onlyKeys, pass, type Policy } from "../types.js";

export interface LeaseRule {
  readonly name: string;
  readonly path: string | undefined;
  readonly blocks: readonly (readonly string[])[];
}

function argvList(value: unknown, where: string): string[][] {
  const valid =
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length > 0 &&
        item.every((word) => typeof word === "string"),
    );
  if (!valid) throw new Error(`${where} must be a list of argv prefixes`);
  return value as string[][];
}

// Match complete argument words so messages that mention commands cannot acquire policy meaning.
export function startsWith(
  argv: readonly string[],
  prefix: readonly string[],
): boolean {
  if (argv.length < prefix.length) return false;
  return prefix.every((word, at) =>
    at === 0 ? program(argv[0]) === word : argv[at] === word,
  );
}

function blocked(
  steps: readonly ShellStep[] | undefined,
  command: string,
  rule: LeaseRule,
): boolean {
  if (!steps)
    return rule.blocks.some((prefix) => command.includes(prefix.join(" ")));
  return realSteps(steps).some((step) =>
    rule.blocks.some((prefix) => startsWith(step.argv, prefix)),
  );
}

export const leases: Policy<readonly LeaseRule[]> = {
  id: "sessions.leases",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options(raw) {
    return Object.entries(raw).map(([name, value]) => {
      const table = (value ?? {}) as Record<string, unknown>;
      onlyKeys(table, ["path", "blocks"]);
      if (table["path"] !== undefined && typeof table["path"] !== "string")
        throw new Error(`${name}.path must be a string`);
      return {
        name,
        path: table["path"] as string | undefined,
        blocks: argvList(table["blocks"], `${name}.blocks`),
      };
    });
  },
  evaluate(input, ctx) {
    const call = shellCall(input);
    if (!call) return pass;
    for (const rule of ctx.options) {
      if (!blocked(call.steps, call.command, rule)) continue;
      const lease = ctx.store.leases.read(rule.name);
      if (!lease) continue;
      return {
        verdict: "deny",
        reason: `A ${rule.path ?? rule.name} change is being delivered (${lease.subject}, since ${lease.since}). This command waits for it; retry once the delivery finishes.`,
      };
    }
    return pass;
  },
};
