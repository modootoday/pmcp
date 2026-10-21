import type { NeutralEvent, ToolKind } from "../../contract.js";

// opencode 1.18.33 has no shell hooks; these are the plugin hooks and bus events the generated
// plugin forwards to hook.mjs. session.idle is observe-only, so stop serves the registry alone.
export const NATIVE_EVENTS: Readonly<Partial<Record<NeutralEvent, string>>> = {
  session_start: "session.created",
  prompt: "chat.message",
  before_tool: "tool.execute.before",
  after_tool: "tool.execute.after",
  stop: "session.idle",
};

export const NEUTRAL_EVENTS: Readonly<Record<string, NeutralEvent>> =
  Object.fromEntries(
    Object.entries(NATIVE_EVENTS).map(([neutral, native]) => [native, neutral]),
  ) as Record<string, NeutralEvent>;

// Names from the 1.18.33 recordings (bash, write) and the plugin API's tool list.
export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  bash: "shell",
  write: "edit",
  edit: "edit",
  patch: "edit",
  read: "read",
  list: "read",
  glob: "read",
  grep: "read",
};

export function toolKind(name: string): ToolKind {
  return TOOL_KINDS[name] ?? "other";
}
