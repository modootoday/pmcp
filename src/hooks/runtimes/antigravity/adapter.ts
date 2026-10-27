import type { RuntimeAdapter } from "../types.js";
import { capabilities } from "./capabilities.js";
import { NATIVE_EVENTS } from "./events.js";
import { render, silent, verdict } from "./output.js";
import { normalize } from "./payload.js";
import { HOOK_SET, HOOKS_FILE, project } from "./projection.js";
import { synthetic } from "./synthetic.js";

export const antigravity: RuntimeAdapter = {
  id: "antigravity",
  synthetic,
  capabilities,
  bindings(event, _tools, timeoutSec) {
    const native = NATIVE_EVENTS[event];
    if (!native || capabilities.events[event] === "unsupported") return [];
    return [{ event, native, timeoutSec }];
  },
  normalize,
  render,
  readVerdict: verdict,
  silent,
  project,
  nativeFiles: [{ file: HOOKS_FILE, root: HOOK_SET }],
  nativeEvent: (event) => NATIVE_EVENTS[event],
  trust: "none",
};
