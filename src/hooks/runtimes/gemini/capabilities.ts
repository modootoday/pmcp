import type { Capabilities } from "../types.js";

// Measured on gemini 0.63.0, 2026-10-20: BeforeTool context is not
// delivered; ask is unsupported because only allow and deny decisions exist.
export const capabilities: Capabilities = {
  events: {
    session_start: "measured",
    prompt: "measured",
    before_tool: "measured",
    after_tool: "measured",
    stop: "measured",
    session_end: "measured",
    notification: "unqualified",
  },
  outputs: {
    deny: "measured",
    ask: "unsupported",
    context: "measured",
    feedback: "unqualified",
  },
  context: ["session_start", "prompt", "after_tool"],
};
