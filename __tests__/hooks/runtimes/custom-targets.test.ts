import { describe, expect, it } from "vitest";

import { legacyEntries } from "../../../src/hooks/compile/custom.js";
import type { CustomEntry } from "../../../src/hooks/compile/types.js";

const entry = (targets: CustomEntry["targets"]): CustomEntry =>
  ({
    name: "policy",
    command: ["node", ".agents/guards/policy.mjs"],
    targets,
    timeoutMs: 500,
    event: "before_shell",
  }) as CustomEntry;

describe("custom guard targets are served by the bundle or the shell adapter, never neither", () => {
  it("keeps unbundled shell-served runtimes with the shell adapter", () => {
    const kept = legacyEntries(
      [entry(["gemini", "antigravity", "codex", "claude"])],
      true,
      ["claude", "gemini"],
    );
    expect(kept.map((e) => e.targets)).toEqual([["antigravity", "codex"]]);
  });

  it.each(["claude", "grok", "opencode"] as const)(
    "refuses a %s custom guard the bundle does not run",
    (id) => {
      expect(() => legacyEntries([entry([id])], true, ["codex"])).toThrow(
        `${id} custom guards need [hooks] targets that include ${id}`,
      );
      expect(() => legacyEntries([entry([id])], false)).toThrow(
        "need [hooks] targets",
      );
    },
  );
});
