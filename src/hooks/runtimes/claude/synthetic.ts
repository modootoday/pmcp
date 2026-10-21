import type { SyntheticOptions } from "../types.js";

export function synthetic(options: SyntheticOptions): Record<string, unknown> {
  const { cwd, session, event, command, path, tool } = options;
  const defaults: Record<string, string> = {
    shell: "Bash",
    edit: "Edit",
    read: "Read",
    other: "Unknown",
  };
  let name = tool ? (defaults[tool] ?? tool) : undefined;
  if (!name && command !== undefined) name = "Bash";
  if (!name && path !== undefined) name = "Edit";
  return {
    session_id: session,
    cwd,
    hook_event_name: event,
    prompt_id: "pmcp-hooks-test-turn",
    ...(name
      ? { tool_name: name, tool_input: { command, file_path: path } }
      : {}),
    ...(event === "Stop" ? { stop_hook_active: false } : {}),
  };
}
