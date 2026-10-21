import type { CompiledPolicy } from "../compiled.js";
import type { NeutralEvent, RuntimeId, ToolKind } from "../contract.js";
import { customPolicy, POLICIES } from "../policies/index.js";
import type { Policy } from "../policies/types.js";
import { RUNTIMES } from "../runtimes/index.js";
import type { NativeBinding } from "../runtimes/types.js";

const BASE_TIMEOUT_SEC = 10;

interface Listener {
  readonly events: readonly NeutralEvent[];
  readonly tools: readonly ToolKind[] | undefined;
}

function listening(
  policy: Policy<any>,
  options: Readonly<Record<string, unknown>>,
): Listener {
  const events = policy.eventsFor
    ? policy.eventsFor(policy.options(options))
    : policy.events;
  return { events, tools: policy.tools };
}

function listeners(policy: CompiledPolicy, id: RuntimeId): Listener[] {
  const guards = policy.guards.map((guard) =>
    listening(POLICIES[guard.id]!, guard.options),
  );
  const custom = policy.custom
    .filter((entry) => entry.targets.includes(id))
    .map((entry) => listening(customPolicy(entry), {}));
  return [...guards, ...custom];
}

export function bindingsFor(
  policy: CompiledPolicy,
  id: RuntimeId,
): NativeBinding[] {
  const adapter = RUNTIMES[id];
  const wanted = new Map<NeutralEvent, Set<ToolKind>>();
  const want = (event: NeutralEvent, tools: readonly ToolKind[]) => {
    const set = wanted.get(event) ?? new Set<ToolKind>();
    tools.forEach((tool) => set.add(tool));
    wanted.set(event, set);
  };
  for (const listener of listeners(policy, id)) {
    for (const event of listener.events)
      want(event, listener.tools ?? ["other"]);
  }
  if (policy.emergencyOffFile) want("before_tool", ["shell", "edit"]);
  const slowest = Math.max(0, ...policy.custom.map((entry) => entry.timeoutMs));
  const timeoutSec = Math.max(BASE_TIMEOUT_SEC, Math.ceil(slowest / 1000) + 2);
  return [...wanted].flatMap(([event, tools]) =>
    adapter.bindings(event, [...tools], timeoutSec),
  );
}

export function loweringFor(
  targets: readonly RuntimeId[],
  askFallback: "deny" | "warn" | "refuse",
  asks: boolean,
): CompiledPolicy["lowering"] {
  const lowering: Partial<Record<RuntimeId, { ask: "deny" | "warn" }>> = {};
  for (const id of targets) {
    if (RUNTIMES[id].capabilities.outputs.ask !== "unsupported") continue;
    if (askFallback === "refuse" && asks)
      throw new Error(
        `a guard may ask, and ${id} has no ask; set ask_fallback`,
      );
    lowering[id] = { ask: askFallback === "warn" ? "warn" : "deny" };
  }
  return lowering;
}
