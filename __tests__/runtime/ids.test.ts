import { describe, expect, it } from "vitest";

import { RUNTIME_IDS as HOOK_RUNTIME_IDS } from "../../src/hooks/contract.js";
import { AGENT_PROCESS_NAMES } from "../../src/sessions/agent-context.js";
import {
  NATIVE_PLUGIN_RUNTIMES,
  nativePluginRuntimeOf,
} from "../../src/marketplace/export.js";
import { HOST_RUNTIMES } from "../../src/project/host-spec.js";
import { verifiedRuntimesOf } from "../../src/runtime.js";
import {
  EXECUTABLES,
  PRODUCT_NAMES,
  RUNTIME_IDS,
  productNameOf,
  runtimeIdOf,
  spellingsOf,
} from "../../src/runtime/ids.js";

describe("runtime ids", () => {
  it("keeps the hook bundle's copies equal to the owner", () => {
    expect(HOOK_RUNTIME_IDS).toEqual(RUNTIME_IDS);
    expect([...AGENT_PROCESS_NAMES].sort()).toEqual(
      [...Object.values(EXECUTABLES), "pmcp-pty"].sort(),
    );
  });

  it("resolves every spelling of a runtime to its id", () => {
    for (const id of RUNTIME_IDS) expect(runtimeIdOf(id)).toBe(id);
    expect(runtimeIdOf("agy")).toBe("antigravity");
    expect(runtimeIdOf("Claude-Code")).toBe("claude");
    expect(runtimeIdOf("codex-cli")).toBe("codex");
    expect(runtimeIdOf("vim")).toBeNull();
    expect(spellingsOf("antigravity").sort()).toEqual(["agy", "antigravity"]);
  });

  it("gives every product name an id and every id a command", () => {
    for (const name of PRODUCT_NAMES)
      expect(productNameOf(runtimeIdOf(name)!)).toBe(name);
    expect(productNameOf("opencode")).toBeNull();
    expect(Object.keys(EXECUTABLES).sort()).toEqual([...RUNTIME_IDS].sort());
  });

  it("keeps the lists other modules published before the owner existed", () => {
    expect(HOST_RUNTIMES).toEqual([
      "claude",
      "codex",
      "gemini",
      "agy",
      "grok",
      "opencode",
    ]);
    expect(NATIVE_PLUGIN_RUNTIMES).toEqual([
      "claude",
      "codex",
      "gemini",
      "grok",
      "agy",
    ]);
  });

  it("accepts any spelling where a user names a runtime", () => {
    expect(nativePluginRuntimeOf("antigravity")).toBe("agy");
    expect(nativePluginRuntimeOf("agy")).toBe("agy");
    expect(nativePluginRuntimeOf("opencode")).toBeNull();
    expect(
      verifiedRuntimesOf({ "verified-runtimes": "claude codex-cli agy vim" }),
    ).toEqual(["claude-code", "codex-cli", "antigravity"]);
  });
});
