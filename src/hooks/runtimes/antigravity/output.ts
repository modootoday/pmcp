import type { Decision, HookInput, NeutralEvent } from "../../contract.js";

const MAX_REASON = 2000;

// agy 1.3.3 denies a PreToolUse that names no decision, so this runtime always writes one.
export function silent(event: NeutralEvent): string {
  return event === "before_tool" ? '{"decision":"allow"}\n' : "{}\n";
}

// Measured shapes: PreToolUse {decision, reason}; PreInvocation injectSteps ephemeral messages;
// Stop {decision: continue, reason} re-enters the loop once, so only an uncontinued Stop uses it.
export function render(
  input: HookInput,
  decision: Decision,
): { stdout: string; exitCode: number } {
  const blocking = decision.verdict === "deny" || decision.verdict === "ask";
  const reason = (decision.reason ?? "Refused by pmcp").slice(0, MAX_REASON);
  if (input.event === "before_tool") {
    const out = blocking ? { decision: "deny", reason } : { decision: "allow" };
    return { stdout: `${JSON.stringify(out)}\n`, exitCode: 0 };
  }
  const notes = [...(decision.context ?? [])];
  if (blocking) notes.unshift(reason);
  if (decision.feedback) notes.push(decision.feedback);
  let out: Record<string, unknown> = {};
  if (notes.length > 0 && input.event !== "after_tool") {
    if (input.event === "stop" && !input.stop?.active)
      out = { decision: "continue", reason: notes.join("\n\n") };
    if (input.event === "session_start" || input.event === "prompt")
      out = { injectSteps: [{ ephemeralMessage: notes.join("\n\n") }] };
  }
  return { stdout: `${JSON.stringify(out)}\n`, exitCode: 0 };
}
