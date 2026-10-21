import type { RuntimeAdapter } from "../types.js";
import { capabilities } from "./capabilities.js";
import { NATIVE_EVENTS } from "./events.js";
import { render } from "./output.js";
import { normalize } from "./payload.js";
import { files } from "./projection.js";
import { synthetic } from "./synthetic.js";

export const opencode: RuntimeAdapter = {
  id: "opencode",
  synthetic,
  capabilities,
  bindings(event, _tools, timeoutSec) {
    const native = NATIVE_EVENTS[event];
    if (!native || capabilities.events[event] === "unsupported") return [];
    return [{ event, native, timeoutSec }];
  },
  normalize,
  render,
  // opencode has no hook configuration to edit; the projection is the generated plugin file.
  project: () => [],
  files,
  nativeFiles: [],
  nativeEvent: (event) => NATIVE_EVENTS[event],
  trust: "none",
};
