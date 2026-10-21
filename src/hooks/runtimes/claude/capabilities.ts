import type { Capabilities } from "../types.js";

// Claude Code 2.1.303 (2026-10-19): keep ask unqualified because print-mode measurements did not exercise it.
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
    ask: "unqualified",
    context: "measured",
    feedback: "unqualified",
  },
  context: ["session_start", "prompt", "before_tool", "after_tool", "stop"],
};
