import type { NeutralEvent, ToolKind } from "../../contract.js";

// grok 1.0.50 uses Claude's event names in both .grok/hooks and the .claude/settings.json it reads.
export const NATIVE_EVENTS: Readonly<Partial<Record<NeutralEvent, string>>> = {
  session_start: "SessionStart",
  prompt: "UserPromptSubmit",
  before_tool: "PreToolUse",
  after_tool: "PostToolUse",
  stop: "Stop",
  session_end: "SessionEnd",
};

export const NEUTRAL_EVENTS: Readonly<Record<string, NeutralEvent>> =
  Object.fromEntries(
    Object.entries(NATIVE_EVENTS).map(([neutral, native]) => [native, neutral]),
  ) as Record<string, NeutralEvent>;

// Names from the 1.0.50 recordings (run_terminal_command, write) and its tool reference.
export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  run_terminal_command: "shell",
  write: "edit",
  search_replace: "edit",
  read_file: "read",
  list_dir: "read",
  grep_search: "read",
};

export function toolKind(name: string): ToolKind {
  return TOOL_KINDS[name] ?? "other";
}
