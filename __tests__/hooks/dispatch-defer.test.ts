import { describe, expect, it } from "vitest";

import type { HookInput } from "../../src/hooks/contract.js";
import { deferContext } from "../../src/hooks/dispatch/defer.js";
import { scratchStore } from "./helpers.js";

const at = (event: HookInput["event"], session = "s-1"): HookInput => ({
  contract: 2,
  runtime: "codex",
  event,
  session: { id: session },
  cwd: "/w",
  projectRoot: "/w",
});

describe("context a runtime drops waits for the next event that delivers", () => {
  const delivers: HookInput["event"][] = ["prompt", "after_tool"];

  it("holds context at a non-delivering event and prepends it later", () => {
    const store = scratchStore();
    const held = deferContext(
      at("before_tool"),
      { verdict: "deny", reason: "r", context: ["held note"] },
      delivers,
      store,
    );
    expect(held).toEqual({ verdict: "deny", reason: "r" });
    const next = deferContext(
      at("after_tool"),
      { context: ["own"] },
      delivers,
      store,
    );
    expect(next.context).toEqual(["held note", "own"]);
    expect(deferContext(at("prompt"), {}, delivers, store)).toEqual({});
  });

  it("keeps sessions apart and never creates a registry record", () => {
    const store = scratchStore();
    deferContext(at("stop", "a"), { context: ["for a"] }, delivers, store);
    expect(deferContext(at("prompt", "b"), {}, delivers, store)).toEqual({});
    expect(
      deferContext(at("prompt", "a"), {}, delivers, store).context,
    ).toEqual(["for a"]);
    expect(store.registry.list()).toEqual([]);
  });
});
