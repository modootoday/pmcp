import { climbCommand, HOOK_PATH } from "../climb.js";
import type { FileEdit, HookProjection } from "../types.js";

export const HOOKS_FILE = ".agents/hooks.json";
// One named set; the shell adapter keeps its own "pmcp-shell" set beside it.
export const HOOK_SET = "pmcp";
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

// agy sets no project variable but runs a hook from the directory holding hooks.json, inside
// the project. Without a project it still names a decision, since agy reads silence as a deny.
export function command(event: string): string {
  const allow =
    event === "before_tool"
      ? `printf '%s\\n' '{"decision":"allow"}'`
      : undefined;
  return climbCommand(`node ${HOOK_PATH} antigravity ${event}`, allow);
}

// session_start and prompt share PreInvocation, so one entry serves both. Only the "*" matcher
// was measured; dispatch filters by tool kind.
export function project(plan: HookProjection): FileEdit[] {
  const byNative = new Map<string, unknown>();
  for (const binding of plan.bindings) {
    if (byNative.has(binding.native)) continue;
    const event = binding.native === "PreInvocation" ? "prompt" : binding.event;
    const hook = {
      type: "command",
      command: command(event),
      timeout: binding.timeoutSec,
    };
    const entry = TOOL_EVENTS.has(binding.native)
      ? { matcher: "*", hooks: [hook] }
      : hook;
    byNative.set(binding.native, entry);
  }
  return [...byNative].map(([native, entry]) => ({
    file: HOOKS_FILE,
    key: [HOOK_SET, native],
    entries: [entry],
  }));
}
