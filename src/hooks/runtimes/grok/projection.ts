import { climbCommand, HOOK_PATH } from "../climb.js";
import { hookLabel } from "../label.js";
import type { FileEdit, HookProjection } from "../types.js";

export const HOOKS_FILE = ".grok/hooks/pmcp.json";

// grok names its project in GROK_WORKSPACE_ROOT (measured on 1.0.50); else the hook's directory.
export function command(event: string): string {
  return climbCommand(
    `node ${HOOK_PATH} grok ${event}`,
    undefined,
    '"${GROK_WORKSPACE_ROOT:-.}"',
  );
}

// Used only when grok is the sole Claude-style target: grok also runs .claude/settings.json
// hooks, so with claude targeted the Claude projection serves both and this one stays empty.
export function project(plan: HookProjection): FileEdit[] {
  const byEvent = new Map<string, unknown[]>();
  for (const binding of plan.bindings) {
    const entries = byEvent.get(binding.native) ?? [];
    entries.push({
      hooks: [
        {
          type: "command",
          command: command(binding.event),
          timeout: binding.timeoutSec,
          statusMessage: hookLabel(binding.event),
        },
      ],
    });
    byEvent.set(binding.native, entries);
  }
  return [...byEvent].map(([native, entries]) => ({
    file: HOOKS_FILE,
    key: ["hooks", native],
    entries,
  }));
}
