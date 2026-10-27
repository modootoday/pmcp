import type { CompiledPolicy } from "../compiled.js";
import type { HookInput } from "../contract.js";
import { customPolicy, POLICIES } from "../policies/index.js";
import type { Policy } from "../policies/types.js";
import type { Selected } from "./run-policy.js";

// Refuse unknown policy ids so a newer policy file cannot silently lose enforcement.
const unknownGuard = (id: string): Policy<object> => ({
  id,
  events: ["before_tool"],
  fail: "closed",
  defaultMode: "deny",
  options: () => ({}),
  evaluate: () => ({
    verdict: "deny",
    reason: `pmcp does not know guard ${id}; update the hook bundle`,
  }),
});

const TOOL_EVENTS = new Set(["before_tool", "after_tool"]);

function events(selected: Selected): readonly string[] {
  const { policy } = selected;
  if (!policy.eventsFor) return policy.events;
  try {
    return policy.eventsFor(policy.options(selected.options));
  } catch {
    // Pass invalid options through the policy runner so the declared failure mode still applies.
    return policy.events;
  }
}

// Narrow only tool events because session and prompt events have no tool payload.
function listens(selected: Selected, input: HookInput): boolean {
  if (!events(selected).includes(input.event)) return false;
  const tools = selected.policy.tools;
  if (!tools || !TOOL_EVENTS.has(input.event)) return true;
  return input.tool !== undefined && tools.includes(input.tool.kind);
}

export function selectPolicies(
  compiled: CompiledPolicy,
  input: HookInput,
): Selected[] {
  const guards = compiled.guards.map((guard) => ({
    policy: POLICIES[guard.id] ?? unknownGuard(guard.id),
    mode: guard.mode,
    options: guard.options,
  }));
  const custom = compiled.custom.map((entry) => ({
    policy: customPolicy(entry),
    mode: entry.mode ?? "deny",
    options: {},
  }));
  return [...guards, ...custom].filter((selected) => listens(selected, input));
}
