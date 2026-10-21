import { climbCommand, HOOK_PATH } from "../climb.js";
import type { FileEdit, HookProjection } from "../types.js";

export const SETTINGS_FILE = ".gemini/settings.json";

// No $NAME at all: Gemini expands those when it loads settings, changing the trusted identity.
export function command(event: string): string {
  return climbCommand(`node ${HOOK_PATH} gemini ${event}`);
}

// Gemini timeouts are milliseconds; a stable name keeps the trusted-hook identity across runs.
export function project(plan: HookProjection): FileEdit[] {
  const byEvent = new Map<string, unknown[]>();
  for (const binding of plan.bindings) {
    const entries = byEvent.get(binding.native) ?? [];
    entries.push({
      ...(binding.matcher ? { matcher: binding.matcher } : {}),
      hooks: [
        {
          type: "command",
          name: `pmcp-${binding.event}`,
          command: command(binding.event),
          timeout: binding.timeoutSec * 1000,
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
