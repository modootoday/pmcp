import type { Capabilities } from "../types.js";

// codex-cli 0.163.0 (2026-10-19): keep ask unsupported because no accepted ask output was measured.
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
  context: ["session_start", "prompt", "before_tool", "after_tool"],
};
