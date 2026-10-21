import type { NeutralEvent, ToolKind } from "../../contract.js";

export const NATIVE_EVENTS: Readonly<Record<NeutralEvent, string>> = {
  session_start: "SessionStart",
  prompt: "BeforeAgent",
  before_tool: "BeforeTool",
  after_tool: "AfterTool",
  stop: "AfterAgent",
  session_end: "SessionEnd",
  notification: "Notification",
};

export const NEUTRAL_EVENTS: Readonly<Record<string, NeutralEvent>> =
  Object.fromEntries(
    Object.entries(NATIVE_EVENTS).map(([neutral, native]) => [native, neutral]),
  ) as Record<string, NeutralEvent>;

// Names from the 0.63.0 recordings (run_shell_command, write_file) and the bundled tool reference.
export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  run_shell_command: "shell",
  write_file: "edit",
  replace: "edit",
  read_file: "read",
  read_many_files: "read",
  glob: "read",
  search_file_content: "read",
};

export function toolKind(name: string): ToolKind {
  return TOOL_KINDS[name] ?? "other";
}

// Gemini matchers are regular expressions, so an anchored alternation names exact tools.
export function matcherFor(tools: readonly ToolKind[]): string | undefined {
  if (tools.includes("other")) return undefined;
  const names = Object.entries(TOOL_KINDS)
    .filter(([, kind]) => tools.includes(kind))
    .map(([name]) => name);
  return names.length > 0 ? `^(${names.join("|")})$` : undefined;
}
