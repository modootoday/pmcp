import { describe, expect, it } from "vitest";

import { project as claude } from "../../src/hooks/runtimes/claude/projection.js";
import { project as codex } from "../../src/hooks/runtimes/codex/projection.js";
import { project as gemini } from "../../src/hooks/runtimes/gemini/projection.js";
import { project as grok } from "../../src/hooks/runtimes/grok/projection.js";
import type { HookProjection } from "../../src/hooks/runtimes/types.js";

const plan: HookProjection = {
  bindings: [
    { event: "session_start", native: "SessionStart", timeoutSec: 10 },
    { event: "before_tool", native: "PreToolUse", timeoutSec: 10 },
  ],
};

function handlers(edits: ReturnType<typeof codex>): Record<string, unknown>[] {
  return edits.flatMap((edit) =>
    edit.entries.flatMap(
      (entry) => (entry as { hooks: Record<string, unknown>[] }).hooks,
    ),
  );
}

// The operator saw every pmcp hook as "Unnamed hook" in Codex /hooks.
describe("pmcp hooks carry a name the runtime shows", () => {
  it("sets statusMessage for codex, claude and grok", () => {
    for (const project of [codex, claude, grok]) {
      expect(handlers(project(plan)).map((h) => h["statusMessage"])).toEqual([
        "pmcp session start",
        "pmcp before tool",
      ]);
    }
  });

  it("leaves gemini on its own name field, which is part of its trusted identity", () => {
    const hooks = handlers(gemini(plan));
    expect(hooks.map((h) => h["name"])).toEqual([
      "pmcp-session_start",
      "pmcp-before_tool",
    ]);
    expect(hooks.every((h) => !("statusMessage" in h))).toBe(true);
  });
});
