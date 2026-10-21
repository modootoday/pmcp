import type { HookProjection, ProjectedFile } from "../types.js";
import { PLUGIN_TEMPLATE } from "./plugin.js";

export const PLUGIN_FILE = ".opencode/plugins/pmcp.js";

// The plugin forwards only the bound events; their timeouts are milliseconds in the plugin.
export function files(plan: HookProjection): ProjectedFile[] {
  if (plan.bindings.length === 0) return [];
  const timeouts = Object.fromEntries(
    plan.bindings.map((binding) => [binding.event, binding.timeoutSec * 1000]),
  );
  return [
    {
      path: PLUGIN_FILE,
      content: PLUGIN_TEMPLATE.replace(
        "__TIMEOUTS__",
        JSON.stringify(timeouts),
      ),
    },
  ];
}
