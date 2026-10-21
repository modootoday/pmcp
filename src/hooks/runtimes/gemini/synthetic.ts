import type { SyntheticOptions } from "../types.js";

export function synthetic(options: SyntheticOptions): Record<string, unknown> {
  const { cwd, session, event, command, path, tool } = options;
  const defaults: Record<string, string> = {
    shell: "run_shell_command",
    edit: "write_file",
    read: "read_file",
    other: "unknown_tool",
  };
  let name = tool ? (defaults[tool] ?? tool) : undefined;
  if (!name && command !== undefined) name = "run_shell_command";
  if (!name && path !== undefined) name = "write_file";
  const input =
    name === "run_shell_command"
      ? { command: command ?? "" }
      : { file_path: path ?? "", content: "" };
  return {
    session_id: session,
    cwd,
    hook_event_name: event,
    timestamp: new Date(0).toISOString(),
    ...(name ? { tool_name: name, tool_input: input } : {}),
    ...(event === "AfterAgent" ? { stop_hook_active: false } : {}),
  };
}
