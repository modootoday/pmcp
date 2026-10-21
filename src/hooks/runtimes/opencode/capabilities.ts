import type { Capabilities } from "../types.js";

// Measured on opencode 1.18.33, 2026-10-20: the generated plugin refuses
// by throwing, appends context to tool output and holds start and prompt context for the system
// prompt. session.idle cannot hold the turn; there is no session end, notification or ask.
export const capabilities: Capabilities = {
  events: {
    session_start: "measured",
    prompt: "measured",
    before_tool: "measured",
    after_tool: "measured",
    stop: "measured",
    session_end: "unsupported",
    notification: "unsupported",
  },
  outputs: {
    deny: "measured",
    ask: "unsupported",
    context: "measured",
    feedback: "unsupported",
  },
  context: ["session_start", "prompt", "after_tool"],
};
