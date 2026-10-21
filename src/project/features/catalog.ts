import type { CompiledPolicy } from "../../hooks/compiled.js";
import type { NeutralEvent } from "../../hooks/contract.js";
import { FEATURES, GUARDS } from "../../hooks/policies/index.js";

export type Output = "deny" | "ask" | "context" | "feedback";

export interface FeatureNeeds {
  readonly id: string;
  readonly events: readonly NeutralEvent[];
  readonly outputs: readonly Output[];
  readonly fields: readonly string[];
}

const NOTICE_EVENTS: Readonly<Record<string, readonly NeutralEvent[]>> = {
  "sessions.registry": ["session_start", "before_tool", "session_end"],
  "sessions.pause": ["session_start", "prompt", "before_tool"],
  "sessions.broadcast": ["session_start", "prompt", "before_tool"],
  "sessions.mailbox": ["session_start", "prompt", "before_tool"],
  "git.shared_checkout": ["session_start", "prompt", "before_tool"],
  "git.worktrees.sync": ["session_start", "prompt"],
};

const OUTPUTS: Readonly<Record<string, readonly Output[]>> = {
  "sessions.registry": [],
  "sessions.pause": ["deny", "context"],
  "sessions.leases": ["deny"],
  "sessions.roles": ["deny"],
  "sessions.broadcast": ["context"],
  "sessions.mailbox": ["context"],
  "git.shared_checkout": ["context"],
  "git.worktrees.sync": ["context"],
  "git.mainline.deliver": ["deny"],
};

function guardOutputs(id: string, policy: CompiledPolicy | null): Output[] {
  const mode =
    policy?.guards.find((guard) => guard.id === id)?.mode ??
    GUARDS[id]?.defaultMode;
  if (mode === "ask") return ["ask"];
  if (mode === "graded") return ["deny", "ask"];
  if (mode === "warn") return ["context"];
  return ["deny"];
}

export function featureCatalog(policy: CompiledPolicy | null): FeatureNeeds[] {
  const features = Object.keys(FEATURES).map((id) => ({
    id,
    events: NOTICE_EVENTS[id] ?? (["before_tool"] as NeutralEvent[]),
    outputs: OUTPUTS[id] ?? [],
    fields: id === "sessions.roles" ? ["agent_type"] : [],
  }));
  const guards = Object.keys(GUARDS).map((id) => ({
    id,
    events: ["before_tool"] as NeutralEvent[],
    outputs: guardOutputs(id, policy),
    fields: [],
  }));

  const checks: FeatureNeeds[] = [
    {
      id: "checks.after_edit",
      events: ["after_tool"],
      outputs: ["context"],
      fields: [],
    },
    {
      id: "checks.on_stop",
      events: ["after_tool", "stop"],
      outputs: ["context"],
      fields: [],
    },
  ];
  const custom = (policy?.custom ?? []).map((entry) => ({
    id: `custom.${entry.name}`,
    events: [
      entry.event === "after_edit" ? "after_tool" : "before_tool",
    ] as NeutralEvent[],
    outputs: [entry.event === "after_edit" ? "feedback" : "deny"] as Output[],
    fields: [],
  }));
  return [...features, ...guards, ...checks, ...custom];
}
