import type { SyntheticOptions } from "../types.js";

export function synthetic(options: SyntheticOptions): Record<string, unknown> {
  const { cwd, session, event, command, path, tool } = options;
  const defaults: Record<string, string> = {
    shell: "run_terminal_command",
    edit: "write",
    read: "read_file",
    other: "unknown_tool",
  };
  let name = tool ? (defaults[tool] ?? tool) : undefined;
  if (!name && command !== undefined) name = "run_terminal_command";
  if (!name && path !== undefined) name = "write";
  const input =
    name === "run_terminal_command"
      ? { command: command ?? "" }
      : { file_path: path ?? "", content: "" };
  return {
    hookEventName: event,
    sessionId: session,
    cwd,
    workspaceRoot: cwd,
    session_id: session,
    hook_event_name: event,
    ...(name
      ? { toolName: name, toolInput: input, tool_name: name, tool_input: input }
      : {}),
    ...(event === "Stop"
      ? { stopHookActive: false, stop_hook_active: false }
      : {}),
  };
}
