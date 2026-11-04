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
    at === 0 ? program(argv[0]) === word : argWord(argv[at], word),
  );
}

const SCRIPT = /(?:\/|\.[A-Za-z0-9]{1,8}$)/u;

// A script word (a path, or a name with an extension) also matches the same script given by a
// longer path, so ["node", "land.mjs"] refuses node tools/land.mjs; other words match exactly.
function argWord(arg: string | undefined, word: string): boolean {
  if (arg === undefined) return false;
  if (arg === word) return true;
  return SCRIPT.test(word) && arg.endsWith(`/${word.replace(/^\.\//u, "")}`);
}

function blocked(steps: readonly ShellStep[], rule: LeaseRule): boolean {
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
      // file and events place the lease for other tools; the store reads them, not this guard.
      onlyKeys(table, ["path", "blocks", "file", "events"]);
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
      if (!blocked(call.steps, rule)) continue;
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
