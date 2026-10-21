import type { Capabilities } from "../types.js";

// Measured on grok 1.0.50, 2026-10-20: SessionStart and UserPromptSubmit
// context is not delivered; before_tool context arrives after the call ran. Ask is documented only.
export const capabilities: Capabilities = {
  events: {
    session_start: "measured",
    prompt: "measured",
    before_tool: "measured",
    after_tool: "measured",
    stop: "measured",
    session_end: "measured",
    notification: "unsupported",
  },
  outputs: {
    deny: "measured",
    ask: "unsupported",
    context: "measured",
    feedback: "unqualified",
  },
  context: ["before_tool", "after_tool", "stop"],
};
