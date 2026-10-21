import type { RuntimeAdapter } from "../types.js";
import { capabilities } from "./capabilities.js";
import { NATIVE_EVENTS } from "./events.js";
import { render } from "./output.js";
import { claims, normalize } from "./payload.js";
import { HOOKS_FILE, project } from "./projection.js";
import { synthetic } from "./synthetic.js";

export const grok: RuntimeAdapter = {
  id: "grok",
  synthetic,
  capabilities,
  // No matcher: only grok's Claude aliases (Bash, Write) were measured, and dispatch filters.
  bindings(event, _tools, timeoutSec) {
    const native = NATIVE_EVENTS[event];
    if (!native || capabilities.events[event] === "unsupported") return [];
    return [{ event, native, timeoutSec }];
  },
  normalize,
  render,
  project,
  nativeFiles: [{ file: HOOKS_FILE, root: "hooks" }],
  nativeEvent: (event) => NATIVE_EVENTS[event],
  ridesOn: { runtime: "claude", claims },
  trust: "folder",
};
