import type { AskFallback } from "../compiled.js";
import type { Decision, Mode, Verdict } from "../contract.js";

const RANK: Readonly<Record<Verdict, number>> = { allow: 0, ask: 1, deny: 2 };

export function applyMode(
  id: string,
  decision: Decision,
  mode: Mode,
): Decision {
  if (mode === "observe") return {};
  if (!decision.verdict || decision.verdict === "allow") return decision;
  if (mode === "off") return {};
  if (mode === "graded") return decision;
  if (mode === "warn") {
    const note = `pmcp ${id}: ${decision.reason ?? "would refuse this call"}`;
    return { context: [...(decision.context ?? []), note] };
  }
  return { ...decision, verdict: mode };
}

export function compose(decisions: readonly Decision[]): Decision {
  let winner: Decision = {};
  const context: string[] = [];
  const feedback: string[] = [];
  for (const decision of decisions) {
    context.push(...(decision.context ?? []));
    if (decision.feedback) feedback.push(decision.feedback);
    if (!decision.verdict) continue;
    if (!winner.verdict || RANK[decision.verdict] > RANK[winner.verdict])
      winner = decision;
  }
  return {
    ...(winner.verdict ? { verdict: winner.verdict } : {}),
    ...(winner.reason ? { reason: winner.reason } : {}),
    ...(context.length > 0 ? { context } : {}),
    ...(feedback.length > 0 ? { feedback: feedback.join("\n\n") } : {}),
  };
}

export function lower(
  decision: Decision,
  lowering: { readonly ask: AskFallback } | undefined,
): Decision {
  if (decision.verdict !== "ask" || !lowering) return decision;
  if (lowering.ask === "deny") return { ...decision, verdict: "deny" };
  const { verdict: _verdict, reason, ...rest } = decision;
  return {
    ...rest,
    context: [...(decision.context ?? []), `pmcp: ${reason ?? "would ask"}`],
  };
}
