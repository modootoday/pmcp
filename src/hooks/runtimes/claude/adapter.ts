import type { RuntimeAdapter } from "../types.js";
import { capabilities } from "./capabilities.js";
import { NATIVE_EVENTS, matcherFor } from "./events.js";
import { render } from "./output.js";
import { normalize } from "./payload.js";
import { project, SETTINGS_FILE } from "./projection.js";
import { synthetic } from "./synthetic.js";

const TOOL_EVENTS = new Set(["before_tool", "after_tool"]);

export const claude: RuntimeAdapter = {
  id: "claude",
  synthetic,
  capabilities,
  bindings(event, tools, timeoutSec) {
    if (capabilities.events[event] === "unsupported") return [];
    const matcher = TOOL_EVENTS.has(event) ? matcherFor(tools) : undefined;
    return [
      {
        event,
        native: NATIVE_EVENTS[event],
        ...(matcher ? { matcher } : {}),
        timeoutSec,
      },
    ];
  },
  normalize,
  render,
  project,
  nativeFiles: [{ file: SETTINGS_FILE, root: "hooks" }],
  nativeEvent: (event) => NATIVE_EVENTS[event],
  trust: "none",
};
