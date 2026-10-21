import { describe, expect, it } from "vitest";

import { compileHooks } from "../../src/hooks/compile.js";

const compile = (sessions: Record<string, unknown>) =>
  compileHooks(
    { hooks: { targets: ["claude"] }, sessions },
    { root: "/w", tools: new Set(["claude"]) },
  );

describe("[sessions.mailbox] compiles into the hook policy", () => {
  it("adds the delivery guard with the role table and the store settings", () => {
    const out = compile({
      mailbox: { ttl_minutes: 90, max_delivered: 2 },
      roles: { reviewer: { agent_type: "code-reviewer" } },
    });
    expect(out.policy?.guards).toContainEqual({
      id: "sessions.mailbox",
      mode: "warn",
      options: { roles: { reviewer: { agent_type: "code-reviewer" } } },
    });
    expect(out.policy?.sessions.mailbox).toEqual({
      enabled: true,
      ttlMinutes: 90,
      maxDelivered: 2,
      audit: true,
    });
  });

  it("leaves the policy unchanged without the table or with enabled = false", () => {
    for (const sessions of [
      { registry: {} },
      { registry: {}, mailbox: { enabled: false } },
    ]) {
      const out = compile(sessions);
      expect(out.policy?.guards.map((guard) => guard.id)).not.toContain(
        "sessions.mailbox",
      );
      expect(out.policy?.sessions).not.toHaveProperty("mailbox");
    }
  });
});
