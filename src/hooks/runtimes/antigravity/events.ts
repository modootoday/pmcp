import type { NeutralEvent, ToolKind } from "../../contract.js";

// agy 1.3.3 has no session or prompt event: PreInvocation fires before every model call, and
// payload.ts reads its counters to tell the first call of a conversation or of a turn.
export const NATIVE_EVENTS: Readonly<Partial<Record<NeutralEvent, string>>> = {
  session_start: "PreInvocation",
  prompt: "PreInvocation",
  before_tool: "PreToolUse",
  after_tool: "PostToolUse",
  stop: "Stop",
};

// Names from the 1.3.3 recordings (run_command, write_to_file) and current agy CLI tools.
export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  run_command: "shell",
  write_to_file: "edit",
  write_file: "edit",
  edit_file: "edit",
  replace_file_content: "edit",
  multi_replace_file_content: "edit",
  view_file: "read",
  read_file: "read",
  list_dir: "read",
  grep_search: "read",
};

export function toolKind(name: string): ToolKind {
  return TOOL_KINDS[name] ?? "other";
}
