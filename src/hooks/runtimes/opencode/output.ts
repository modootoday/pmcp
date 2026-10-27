import type { Decision, HookInput } from "../../contract.js";
import { readAnswer, type ReadVerdict } from "../answer.js";

const MAX_REASON = 2000;
const DELIVERS: readonly HookInput["event"][] = [
  "session_start",
  "prompt",
  "after_tool",
];

// The answer the generated plugin reads: deny becomes a thrown error in tool.execute.before;
// context is appended to the tool output or held for the next system prompt.
export function render(
  input: HookInput,
  decision: Decision,
): { stdout: string; exitCode: number } {
  const blocking = decision.verdict === "deny" || decision.verdict === "ask";
  const reason = (decision.reason ?? "Refused by pmcp").slice(0, MAX_REASON);
  if (input.event === "before_tool") {
    const out = blocking ? { deny: reason } : {};
    return { stdout: `${JSON.stringify(out)}\n`, exitCode: 0 };
  }
  const notes = [...(decision.context ?? [])];
  if (blocking) notes.unshift(reason);
  if (decision.feedback) notes.push(decision.feedback);
  const out =
    notes.length > 0 && DELIVERS.includes(input.event)
      ? { context: notes.join("\n\n") }
      : {};
  return { stdout: `${JSON.stringify(out)}\n`, exitCode: 0 };
}

// A before_tool answer read back as its verdict (pmcp hooks test --fixtures).
export function verdict(stdout: string): ReadVerdict | null {
  return readAnswer(stdout, (out) => ("deny" in out ? "deny" : "allow"));
}
