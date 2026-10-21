import type { HookTool, ShellHookSpec } from "../hook-spec.js";
import type { Decision } from "./types.js";
export function nativeHookDecision(
  tool: HookTool,
  decision: Decision,
  event?: ShellHookSpec["event"],
): object {
  if (tool === "codex" && event === "after_edit") {
    if (decision.decision === "allow") return {};
    return {
      decision: "block",
      reason: decision.reason ?? "Edit guard failed validation or execution",
    };
  }
  if (tool === "codex") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.decision,
        ...(decision.reason
          ? { permissionDecisionReason: decision.reason }
          : {}),
      },
    };
  }
  return decision;
}
