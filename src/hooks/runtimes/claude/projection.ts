import { hookLabel } from "../label.js";
import type { FileEdit, HookProjection } from "../types.js";

export const SETTINGS_FILE = ".claude/settings.json";

// Use CLAUDE_PROJECT_DIR so nested working directories resolve the same projected bundle.
export function command(event: string): string {
  return `node "$CLAUDE_PROJECT_DIR/.agents/pmcp-hooks/hook.mjs" claude ${event}`;
}

export function project(plan: HookProjection): FileEdit[] {
  const byEvent = new Map<string, unknown[]>();
  for (const binding of plan.bindings) {
    const entries = byEvent.get(binding.native) ?? [];
    entries.push({
      ...(binding.matcher ? { matcher: binding.matcher } : {}),
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
    file: SETTINGS_FILE,
    key: ["hooks", native],
    entries,
  }));
}
