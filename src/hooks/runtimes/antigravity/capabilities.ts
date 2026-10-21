import type { Capabilities } from "../types.js";

// Measured on agy 1.3.3, 2026-10-20: no session end or notification event;
// session start and prompt are read from PreInvocation counters. Ask cannot prompt headless.
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
    feedback: "unqualified",
  },
  context: ["session_start", "prompt", "stop"],
};
