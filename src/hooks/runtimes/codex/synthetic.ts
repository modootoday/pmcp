import type { SyntheticOptions } from "../types.js";

export function synthetic(options: SyntheticOptions): Record<string, unknown> {
  const { cwd, session, event, command, path, tool } = options;
  const defaults: Record<string, string> = {
    shell: "Bash",
    edit: "apply_patch",
    other: "Unknown",
  };
  let name = tool ? (defaults[tool] ?? tool) : undefined;
  if (!name && command !== undefined) name = "Bash";
  if (!name && path !== undefined) name = "apply_patch";
  const body =
    name === "apply_patch" && path !== undefined
      ? "*** Begin Patch\n*** Update File: " + path + "\n*** End Patch"
      : command;
  return {
    session_id: session,
    cwd,
    hook_event_name: event,
    turn_id: "pmcp-hooks-test-turn",
    ...(name ? { tool_name: name, tool_input: { command: body } } : {}),
    ...(event === "Stop" ? { stop_hook_active: false } : {}),
  };
}
