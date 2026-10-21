import { describe, expect, it } from "vitest";

import type { HookInput, RuntimeId } from "../../../src/hooks/contract.js";
import { RUNTIMES } from "../../../src/hooks/runtimes/index.js";
import { compiled, decide, guard, scratchStore } from "../helpers.js";

// How one runtime spells a call, built from its recorded payloads.
export interface RuntimeCase {
  readonly runtime: RuntimeId;
  readonly beforeTool: string;
  readonly shell: (command: string) => { native: string; payload: unknown };
  readonly edit: (path: string) => { native: string; payload: unknown };
  readonly refused: RegExp;
}

function input(c: RuntimeCase, call: { native: string; payload: unknown }) {
  const root = "/rec/work/probe";
  const normalized = RUNTIMES[c.runtime].normalize(
    call.native,
    call.payload,
    root,
  );
  expect(normalized).not.toBeNull();
  return normalized as HookInput;
}

async function run(
  c: RuntimeCase,
  call: { native: string; payload: unknown },
  guards: Parameters<typeof compiled>[0],
  store = scratchStore(),
) {
  const hook = input(c, call);
  const decision = await decide(
    hook,
    compiled(guards, { targets: [c.runtime] }),
    {
      store,
    },
  );
  return {
    decision,
    stdout: RUNTIMES[c.runtime].render(hook, decision).stdout,
  };
}

// Every policy family gets an allow and a deny case on this runtime's real payload shape.
export function policyFamilies(c: RuntimeCase): void {
  describe(`${c.runtime}: policy families on recorded payloads`, () => {
    it("shell guard: refuses a heredoc, allows a plain command", async () => {
      const denied = await run(c, c.shell("cat <<EOF > notes.txt\nhi\nEOF"), [
        guard("shell.heredoc"),
      ]);
      expect(denied.decision.verdict).toBe("deny");
      expect(denied.stdout).toMatch(c.refused);
      const allowed = await run(c, c.shell("ls -la"), [guard("shell.heredoc")]);
      expect(allowed.decision.verdict).toBeUndefined();
      expect(allowed.stdout).not.toMatch(c.refused);
    });

    it("git guard: refuses push --no-verify, allows git status", async () => {
      const policy = [guard("git.push_without_verify")];
      expect(
        (await run(c, c.shell("git push --no-verify origin main"), policy))
          .decision.verdict,
      ).toBe("deny");
      expect(
        (await run(c, c.shell("git status"), policy)).decision.verdict,
      ).toBeUndefined();
    });

    it("session pause: refuses an edit and a mutating command while paused", async () => {
      const store = scratchStore();
      store.pause.write({ by: "operator", reason: "incident" });
      const policy = [guard("sessions.pause")];
      expect(
        (await run(c, c.edit("notes.txt"), policy, store)).decision.verdict,
      ).toBe("deny");
      expect(
        (await run(c, c.shell("git commit -m x"), policy, store)).decision
          .verdict,
      ).toBe("deny");
      store.pause.write(null);
      expect(
        (await run(c, c.edit("notes.txt"), policy, store)).decision.verdict,
      ).toBeUndefined();
    });

    it("session registry: a tool call records a heartbeat for its session", async () => {
      const store = scratchStore();
      const call = c.shell("ls");
      await run(c, call, [guard("sessions.registry", "warn")], store);
      const session = input(c, call).session.id;
      expect(session).not.toBe("");
      expect(store.registry.get(session)).toMatchObject({ status: "working" });
    });
  });
}
