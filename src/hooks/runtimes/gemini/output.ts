import type { Decision, HookInput } from "../../contract.js";
import { NATIVE_EVENTS } from "./events.js";

const MAX_REASON = 2000;
const DELIVERS: readonly HookInput["event"][] = [
  "session_start",
  "prompt",
  "after_tool",
];

// 0.63.0 was measured to honour a top-level deny on BeforeTool and context on SessionStart,
// BeforeAgent and AfterTool only. Elsewhere a refusal or feedback becomes context, which
// dispatch holds for the next delivering event; an AfterAgent retry is documented, not measured.
export function render(
  input: HookInput,
  decision: Decision,
): { stdout: string; exitCode: number } {
  const blocking = decision.verdict === "deny" || decision.verdict === "ask";
  const reason = (decision.reason ?? "Refused by pmcp").slice(0, MAX_REASON);
  const out: Record<string, unknown> = {};
  const notes = [...(decision.context ?? [])];
  if (blocking && input.event === "before_tool")
    Object.assign(out, { decision: "deny", reason });
  else if (blocking) notes.unshift(reason);
  if (decision.feedback) notes.push(decision.feedback);
  if (notes.length > 0 && DELIVERS.includes(input.event))
    out["hookSpecificOutput"] = {
      hookEventName: NATIVE_EVENTS[input.event],
      additionalContext: notes.join("\n\n"),
    };
  return { stdout: `${JSON.stringify(out)}\n`, exitCode: 0 };
}
