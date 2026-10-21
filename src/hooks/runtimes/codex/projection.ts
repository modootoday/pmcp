import { climbCommand, HOOK_PATH } from "../climb.js";
import { hookLabel } from "../label.js";
import type { FileEdit, HookProjection } from "../types.js";

export const HOOKS_FILE = ".codex/hooks.json";

// Codex provides no project-directory variable, so the hook climbs from its own directory.
export function command(event: string): string {
  return climbCommand(`node ${HOOK_PATH} codex ${event}`);
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
    file: HOOKS_FILE,
    key: ["hooks", native],
    entries,
  }));
}
