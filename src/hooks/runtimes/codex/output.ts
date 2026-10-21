import type { Decision, HookInput } from "../../contract.js";
import { NATIVE_EVENTS } from "./events.js";

const MAX_REASON = 2000;

// Lower unsupported ask to deny so missing runtime support cannot silently grant permission.
export function render(
  input: HookInput,
  decision: Decision,
): { stdout: string; exitCode: number } {
  const hookEventName = NATIVE_EVENTS[input.event];
  const context = decision.context?.length
    ? decision.context.join("\n\n")
    : undefined;
  const reason = decision.reason?.slice(0, MAX_REASON);
  const blocking = decision.verdict === "deny" || decision.verdict === "ask";
  const out = shape(input, decision, {
    hookEventName,
    context,
    reason,
    blocking,
  });
  // Use an empty Stop object because Codex 0.163.0 rejects other output shapes.
  if (!out && input.event === "stop") return { stdout: "{}\n", exitCode: 0 };
  return { stdout: out ? `${JSON.stringify(out)}\n` : "", exitCode: 0 };
}

interface Parts {
  readonly hookEventName: string | undefined;
  readonly context: string | undefined;
  readonly reason: string | undefined;
  readonly blocking: boolean;
}

function shape(
  input: HookInput,
  decision: Decision,
  parts: Parts,
): Record<string, unknown> | null {
  const { hookEventName, context, reason, blocking } = parts;
  const contextOnly = context
    ? { hookSpecificOutput: { hookEventName, additionalContext: context } }
    : {};
  if (input.event === "before_tool") {
    if (!blocking && !context) return null;
    let refusal: Record<string, unknown> = {};
    if (blocking) {
      refusal = {
        permissionDecision: "deny",
        ...(reason ? { permissionDecisionReason: reason } : {}),
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName,
        ...refusal,
        ...(context ? { additionalContext: context } : {}),
      },
    };
  }
  if (
    input.event === "prompt" ||
    input.event === "after_tool" ||
    input.event === "stop"
  ) {
    const feedback = blocking ? (reason ?? "Refused") : decision.feedback;
    if (!feedback && !context) return null;
    return {
      ...(feedback ? { decision: "block", reason: feedback } : {}),
      ...(input.event === "stop" ? {} : contextOnly),
    };
  }
  if (input.event === "session_start" && context) return contextOnly;
  return null;
}
