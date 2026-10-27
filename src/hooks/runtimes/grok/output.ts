import type { Decision, HookInput } from "../../contract.js";
import { field, readAnswer, type ReadVerdict } from "../answer.js";
import { NATIVE_EVENTS } from "./events.js";

const MAX_REASON = 2000;
const DELIVERS: readonly HookInput["event"][] = [
  "before_tool",
  "after_tool",
  "stop",
];

// grok 1.0.50 was measured to honour permissionDecision deny on PreToolUse and additionalContext
// on PreToolUse, PostToolUse and Stop. Stop context continues the turn, so a continued Stop
// stays silent; elsewhere a refusal or feedback becomes context.
export function render(
  input: HookInput,
  decision: Decision,
): { stdout: string; exitCode: number } {
  const blocking = decision.verdict === "deny" || decision.verdict === "ask";
  const reason = (decision.reason ?? "Refused by pmcp").slice(0, MAX_REASON);
  const notes = [...(decision.context ?? [])];
  const refuse = blocking && input.event === "before_tool";
  if (blocking && !refuse) notes.unshift(reason);
  if (decision.feedback) notes.push(decision.feedback);
  const quiet = input.event === "stop" && input.stop?.active === true;
  const context =
    notes.length > 0 && DELIVERS.includes(input.event) && !quiet
      ? notes.join("\n\n")
      : undefined;
  if (!refuse && !context) return { stdout: "", exitCode: 0 };
  const out = {
    hookSpecificOutput: {
      hookEventName: NATIVE_EVENTS[input.event],
      ...(refuse
        ? { permissionDecision: "deny", permissionDecisionReason: reason }
        : {}),
      ...(context ? { additionalContext: context } : {}),
    },
  };
  return { stdout: `${JSON.stringify(out)}\n`, exitCode: 0 };
}

// A before_tool answer read back as its verdict (pmcp hooks test --fixtures).
export function verdict(stdout: string): ReadVerdict | null {
  return readAnswer(stdout, (out) => {
    const decision = field(out["hookSpecificOutput"], "permissionDecision");
    return decision === "deny" || decision === "ask" ? decision : "allow";
  });
}
