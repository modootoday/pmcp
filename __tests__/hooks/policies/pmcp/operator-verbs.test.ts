import { describe, expect, it } from "vitest";

import { compileHooks } from "../../../../src/hooks/compile.js";
import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { cases, compiled, guard, runShell } from "../../helpers.js";

const RUNTIMES: RuntimeId[] = ["claude", "codex"];
const { blocked, allowed } = cases("pmcp", "operator-verbs");

describe.each(RUNTIMES)("pmcp.operator_verbs on %s payloads", (runtime) => {
  const deny = compiled([guard("pmcp.operator_verbs")]);

  it.each(blocked)("denies and points to the operator: %s", async (command) => {
    const outcome = await runShell(runtime, deny, command);
    expect(outcome.verdict).toBe("deny");
    expect(outcome.stdout).toContain("Ask the operator");
  });

  it.each(allowed)("allows %s", async (command) => {
    const outcome = await runShell(runtime, deny, command);
    expect(outcome.verdict).toBeUndefined();
    expect(outcome.stdout).toBe("");
  });
});

describe("session governance compiles pmcp.operator_verbs", () => {
  const tools = { root: "/p", tools: new Set<string>() };
  const ids = (tables: Parameters<typeof compileHooks>[0]) =>
    compileHooks(tables, tools).policy?.guards.map((entry) => entry.id) ?? [];

  it("in deny mode beside the session guards", () => {
    const sessions = { pause: {} };
    expect(compileHooks({ sessions }, tools).policy?.guards).toContainEqual({
      id: "pmcp.operator_verbs",
      mode: "deny",
      options: {},
    });
  });

  it("not without a session guard, and not over a declared entry", () => {
    expect(ids({ sessions: { state_dir: "/s" } })).toEqual([]);
    const hooks = {
      guards: { pmcp: { operator_verbs: { mode: "off" } } },
    };
    expect(ids({ sessions: { pause: {} }, hooks })).not.toContain(
      "pmcp.operator_verbs",
    );
  });

  it("refuses an operator token file inside the project", () => {
    const sessions = {
      pause: {},
      operator: { via: "token", token_file: "/p/.operator" },
    };
    expect(() => compileHooks({ sessions }, tools)).toThrow(
      "token_file must be outside the project",
    );
  });
});
