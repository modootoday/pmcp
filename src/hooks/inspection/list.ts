import type { CompiledPolicy } from "../compiled.js";
import { POLICIES, customPolicy } from "../policies/index.js";
import type { Mode, NeutralEvent, RuntimeId } from "../contract.js";
import { sourceFor } from "./source.js";
import { RUNTIMES } from "../runtimes/index.js";

export interface PolicyRow {
  runtime: RuntimeId;
  event: NeutralEvent;
  policy: string;
  mode: Mode;
  source: string;
}
export function policyRows(
  compiled: CompiledPolicy | null | undefined,
): PolicyRow[] {
  if (!compiled) return [];
  return compiled.targets.flatMap((runtime) => {
    const guards = compiled.guards.map((guard) => ({
      ...guard,
      policy: POLICIES[guard.id]!,
    }));
    const custom = compiled.custom
      .filter((entry) => entry.targets.includes(runtime))
      .map((entry) => ({
        id: "custom." + entry.name,
        policy: customPolicy(entry),
        options: {},
        mode: "deny" as const,
      }));
    return [...guards, ...custom].flatMap((entry) => {
      const events =
        entry.policy.eventsFor?.(entry.policy.options(entry.options)) ??
        entry.policy.events;
      return events
        .filter(
          (event) =>
            RUNTIMES[runtime].capabilities.events[event] !== "unsupported",
        )
        .map((event) => ({
          runtime,
          event,
          policy: entry.id,
          mode: entry.mode,
          source: sourceFor(entry.id),
        }));
    });
  });
}
