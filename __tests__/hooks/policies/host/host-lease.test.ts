import { describe, expect, it } from "vitest";

import { compileHooks } from "../../../../src/hooks/compile.js";
import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { cases, compiled, guard, runShell } from "../../helpers.js";

const RUNTIMES: RuntimeId[] = ["claude", "codex"];
const fixture = cases("host", "host-lease") as unknown as {
  options: Record<string, unknown>;
  blocked: string[];
  allowed: string[];
};

describe.each(RUNTIMES)("host.lease on %s payloads", (runtime) => {
  const deny = compiled([guard("host.lease", "deny", fixture.options)]);

  it.each(fixture.blocked)("denies with guidance: %s", async (command) => {
    const outcome = await runShell(runtime, deny, command);
    expect(outcome.verdict).toBe("deny");
    expect(outcome.stdout).toContain("Run it as: pmcp heavy -- ");
  });

  it.each(fixture.allowed)("allows %s", async (command) => {
    const outcome = await runShell(runtime, deny, command);
    expect(outcome.verdict).toBeUndefined();
    expect(outcome.stdout).toBe("");
  });

  it("only warns in warn mode and says nothing in observe mode", async () => {
    const warn = compiled([guard("host.lease", "warn", fixture.options)]);
    const warned = await runShell(runtime, warn, "npm install");
    expect(warned.verdict).toBeUndefined();
    expect(warned.stdout).toContain("pmcp heavy -- npm install");
    const observe = compiled([guard("host.lease", "observe", fixture.options)]);
    const observed = await runShell(runtime, observe, "npm install");
    expect(observed.verdict).toBeUndefined();
    expect(observed.stdout).toBe("");
  });
});

describe("[host.lease] compiles host.lease", () => {
  const tools = { root: "/p", tools: new Set<string>() };

  it("in observe mode from the heavy list, with the skip variables", () => {
    const host = {
      lease: { heavy: [["bun", "install"]], legacy_skip_env: "OLD_SKIP" },
    };
    expect(compileHooks({ host }, tools).policy?.guards).toEqual([
      {
        id: "host.lease",
        mode: "observe",
        options: {
          heavy: [["bun", "install"]],
          skip_env: ["PMCP_HEAVY_DISABLE", "OLD_SKIP"],
        },
      },
    ]);
  });

  it("not at all without heavy commands, when disabled, or when off", () => {
    for (const lease of [
      {},
      { enabled: false, heavy: [["bun", "install"]] },
      { guard: "off", heavy: [["bun", "install"]] },
    ])
      expect(compileHooks({ host: { lease } }, tools).policy).toBeNull();
  });
});
