import { describe, expect, it } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import type { SessionStore } from "../../../../src/sessions/types.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  runShell,
  scratchStore,
} from "../../helpers.js";

const BOTH: RuntimeId[] = ["claude", "codex"];
const LOCKFILE = {
  lockfile: {
    path: "bun.lock",
    blocks: [
      ["bun", "install"],
      ["pmcp", "git", "deliver"],
    ],
  },
};
const LANDER = {
  lander: {
    agent_type: "lander",
    allow_edits: false,
    allow_commands: [
      ["pmcp", "git", "deliver"],
      ["git", "log"],
      ["git", "show"],
      ["cat"],
    ],
  },
};

// A shared identifier lets recordings from different sessions exercise one session lifecycle.
function input(
  runtime: RuntimeId,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const payload: Record<string, any> = {
    ...fixture(runtime, name),
    session_id: sessionOf(runtime),
    ...extra,
  };
  return RUNTIMES[runtime].normalize(
    payload["hook_event_name"],
    payload,
    payload["cwd"],
  )!;
}

function editInput(runtime: RuntimeId) {
  return runtime === "claude"
    ? input("claude", "PreToolUse.Edit")
    : input("codex", "PreToolUse.apply_patch");
}

const sessionOf = (runtime: RuntimeId) =>
  fixture(runtime, "PreToolUse.Bash")["session_id"] as string;

describe.each(BOTH)("sessions.pause on %s payloads", (runtime) => {
  const policy = compiled([guard("sessions.pause")]);
  const paused = (by = "operator"): SessionStore => {
    const store = scratchStore();
    store.pause.write({ by, reason: "lockfile incident" });
    return store;
  };

  it("refuses mutating commands and edits from every session but the pauser", async () => {
    const store = paused();
    expect(
      (await runShell(runtime, policy, "git commit -m x", undefined, store))
        .verdict,
    ).toBe("deny");
    expect(
      (
        await runShell(
          runtime,
          policy,
          "bash -c 'bun install'",
          undefined,
          store,
        )
      ).verdict,
    ).toBe("deny");
    expect((await decide(editInput(runtime), policy, { store })).verdict).toBe(
      "deny",
    );
  });

  it("lets reads and commands that only mention a mutating step through", async () => {
    const store = paused();
    expect(
      (
        await runShell(
          runtime,
          policy,
          "git log --oneline -5",
          undefined,
          store,
        )
      ).verdict,
    ).toBeUndefined();
    expect(
      (
        await runShell(
          runtime,
          policy,
          'echo "git push later"',
          undefined,
          store,
        )
      ).verdict,
    ).toBeUndefined();
  });

  it("exempts the pauser by session id and by alias", async () => {
    const own = paused(sessionOf(runtime));
    expect(
      (await runShell(runtime, policy, "git commit -m x", undefined, own))
        .verdict,
    ).toBeUndefined();
    const byAlias = paused("kit");
    byAlias.registry.upsert(sessionOf(runtime), { alias: "kit" });
    expect(
      (await runShell(runtime, policy, "git commit -m x", undefined, byAlias))
        .verdict,
    ).toBeUndefined();
  });

  it("tells a prompt that the workspace is paused", async () => {
    const decision = await decide(input(runtime, "UserPromptSubmit"), policy, {
      store: paused(),
    });
    expect(decision.context?.[0]).toMatch(/paused \(lockfile incident/u);
  });
});

describe.each(BOTH)("sessions.leases on %s payloads", (runtime) => {
  const policy = compiled([guard("sessions.leases", "deny", LOCKFILE)]);

  it("refuses blocked argv prefixes while a live holder has the lease", async () => {
    const store = scratchStore();
    store.leases.take("lockfile", { subject: "bump vitest" });
    const out = await runShell(
      runtime,
      policy,
      "timeout 60 bun install --frozen-lockfile",
      undefined,
      store,
    );
    expect(out.verdict).toBe("deny");
    expect(out.stdout).toMatch(/bump vitest/u);
    expect(
      (
        await runShell(
          runtime,
          policy,
          "pmcp git deliver abc",
          undefined,
          store,
        )
      ).verdict,
    ).toBe("deny");
  });

  it("allows other commands and every command once the holder is gone", async () => {
    const store = scratchStore();
    store.leases.take("lockfile", { subject: "bump" });
    expect(
      (
        await runShell(
          runtime,
          policy,
          "git commit -m 'bun install later'",
          undefined,
          store,
        )
      ).verdict,
    ).toBeUndefined();
    const dead = scratchStore();
    dead.leases.take("lockfile", { subject: "dead", pid: 2 ** 30 });
    expect(
      (await runShell(runtime, policy, "bun install", undefined, dead)).verdict,
    ).toBeUndefined();
  });
});

describe("sessions.roles", () => {
  const policy = compiled([guard("sessions.roles", "deny", LANDER)]);
  const lander = (command: string) =>
    input("claude", "PreToolUse.Bash", {
      agent_type: "fleet:lander",
      tool_input: { command },
    });

  it("allows a role only the argv prefixes it lists, step by step", async () => {
    expect(
      (await decide(lander("pmcp git deliver abc def"), policy)).verdict,
    ).toBeUndefined();
    expect(
      (await decide(lander("git show --stat abc && git log -1"), policy))
        .verdict,
    ).toBeUndefined();
    expect(
      (await decide(lander("git log -1 && rm -rf x"), policy)).verdict,
    ).toBe("deny");
    expect(
      (await decide(lander("git rebase origin/main"), policy)).verdict,
    ).toBe("deny");
  });

  it("refuses a role's edits and leaves sessions without the role alone", async () => {
    const edit = input("claude", "PreToolUse.Edit", { agent_type: "lander" });
    expect((await decide(edit, policy)).verdict).toBe("deny");
    expect(
      (
        await decide(
          input("claude", "PreToolUse.Bash", {
            tool_input: { command: "rm -rf x" },
          }),
          policy,
        )
      ).verdict,
    ).toBeUndefined();
  });

  it("never applies on Codex, which reports no agent type", async () => {
    const codex = input("codex", "PreToolUse.Bash", {
      agent_type: "lander",
      tool_input: { command: "rm -rf x" },
    });
    expect(codex.session.agentType).toBeUndefined();
    expect((await decide(codex, policy)).verdict).toBeUndefined();
  });
});

describe.each(BOTH)("sessions.broadcast on %s payloads", (runtime) => {
  const policy = compiled([
    guard("sessions.registry", "warn"),
    guard("sessions.broadcast", "warn", {
      deliver_on: ["session_start", "prompt", "before_tool", "stop"],
    }),
  ]);

  it("delivers a broadcast once per session and never to its sender", async () => {
    const store = scratchStore();
    await decide(input(runtime, "SessionStart"), policy, { store });
    store.broadcast.post({ by: "operator", text: "freeze main" });
    const first = await decide(input(runtime, "UserPromptSubmit"), policy, {
      store,
    });
    expect(first.context?.[0]).toMatch(/Operator broadcast .*freeze main/u);
    expect(
      (await decide(input(runtime, "UserPromptSubmit"), policy, { store }))
        .context,
    ).toBeUndefined();
    store.broadcast.post({ by: sessionOf(runtime), text: "mine" });
    expect(
      (await decide(input(runtime, "UserPromptSubmit"), policy, { store }))
        .context,
    ).toBeUndefined();
  });

  it("delivers on Stop only when the Stop was not continued, and once per turn", async () => {
    const store = scratchStore();
    await decide(input(runtime, "SessionStart"), policy, { store });
    store.broadcast.post({ by: "operator", text: "one" });
    expect(
      (
        await decide(
          input(runtime, "Stop", { stop_hook_active: true }),
          policy,
          { store },
        )
      ).context,
    ).toBeUndefined();
    const stop = await decide(input(runtime, "Stop"), policy, { store });
    if (runtime === "codex") {
      // Codex drops Stop context, so the notice is held and rides the next prompt.
      expect(stop.context).toBeUndefined();
      const next = await decide(input(runtime, "UserPromptSubmit"), policy, {
        store,
      });
      expect(next.context?.[0]).toMatch(/one/u);
    } else {
      expect(stop.context?.[0]).toMatch(/one/u);
    }
    store.broadcast.post({ by: "operator", text: "two" });
    expect(
      (await decide(input(runtime, "Stop"), policy, { store })).context,
    ).toBeUndefined();
  });
});

describe.each(BOTH)("sessions.registry on %s payloads", (runtime) => {
  const policy = compiled([guard("sessions.registry", "warn")]);

  it("records the runtime pid at session start, a heartbeat per event and removes the record at the end", async () => {
    const store = scratchStore();
    const session = sessionOf(runtime);
    await decide(input(runtime, "SessionStart"), policy, { store });
    expect(store.registry.get(session)).toMatchObject({
      runtime,
      status: "idle",
      pid: expect.any(Number),
    });
    await decide(
      input(runtime, "PreToolUse.Bash", { tool_input: { command: "ls -la" } }),
      policy,
      { store },
    );
    expect(store.registry.get(session)?.lastAction).toMatch(/ls -la/u);
    expect(store.registry.list()[0]?.live).toBe(true);
    await decide(input(runtime, "SessionEnd"), policy, { store });
    expect(store.registry.get(session)).toBeNull();
  });

  it("sweeps a record whose runtime process is gone", () => {
    const store = scratchStore();
    store.registry.upsert("deadbeef-0000", { pid: 2 ** 30 });
    store.registry.upsert("alivebeef-0000", { pid: process.pid });
    expect(store.registry.sweep()).toBe(1);
    expect(store.registry.list().map((record) => record.session)).toEqual([
      "alivebeef-0000",
    ]);
  });
});
