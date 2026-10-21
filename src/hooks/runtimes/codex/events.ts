import type { NeutralEvent, ToolKind } from "../../contract.js";

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

export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  Bash: "shell",
  exec_command: "shell",
  shell: "shell",
  shell_command: "shell",
  apply_patch: "edit",
};

export function toolKind(name: string): ToolKind {
  return TOOL_KINDS[name] ?? "other";
}

export function matcherFor(tools: readonly ToolKind[]): string | undefined {
  if (tools.includes("other")) return undefined;
  const names = Object.entries(TOOL_KINDS)
    .filter(([, kind]) => tools.includes(kind))
    .map(([name]) => name);
  return names.length > 0 ? names.join("|") : undefined;
}
