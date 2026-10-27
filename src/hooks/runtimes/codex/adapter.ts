import type { NativeBinding, RuntimeAdapter } from "../types.js";
import { capabilities } from "./capabilities.js";
import { NATIVE_EVENTS, matcherFor } from "./events.js";
import { render, verdict } from "./output.js";
import { normalize } from "./payload.js";
import { HOOKS_FILE, project } from "./projection.js";
import { synthetic } from "./synthetic.js";

const TOOL_EVENTS = new Set(["before_tool", "after_tool"]);
// Limit SessionEnd to 3 seconds because Codex clamps longer hook timeouts.
export const SESSION_END_TIMEOUT_SEC = 3;

export const codex: RuntimeAdapter = {
  id: "codex",
  synthetic,
  capabilities,
  bindings(event, tools, timeoutSec): NativeBinding[] {
    const native = NATIVE_EVENTS[event];
    if (!native || capabilities.events[event] === "unsupported") return [];
    const matcher = TOOL_EVENTS.has(event) ? matcherFor(tools) : undefined;
    const timeout =
      event === "session_end"
        ? Math.min(timeoutSec, SESSION_END_TIMEOUT_SEC)
        : timeoutSec;
    return [
      { event, native, ...(matcher ? { matcher } : {}), timeoutSec: timeout },
    ];
  },
  normalize,
  render,
  readVerdict: verdict,
  project,
  nativeFiles: [{ file: HOOKS_FILE, root: "hooks" }],
  nativeEvent: (event) => NATIVE_EVENTS[event],
  trust: "hash_review",
};
