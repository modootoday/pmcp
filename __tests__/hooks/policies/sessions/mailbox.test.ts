import { describe, expect, it } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  MAILBOX_ON,
  scratchStore,
} from "../../helpers.js";

// The recorded before-tool payload, and for runtimes that do not show context there, the next
// recorded event that does: held context must arrive there.
const CASES: readonly [RuntimeId, [string, string], [string, string] | null][] =
  [
    ["claude", ["PreToolUse", "PreToolUse.Bash"], null],
    ["codex", ["PreToolUse", "PreToolUse.Bash"], null],
    ["grok", ["PreToolUse", "PreToolUse.run_terminal_command"], null],
    [
      "gemini",
      ["BeforeTool", "BeforeTool.run_shell_command"],
      ["AfterTool", "AfterTool.run_shell_command"],
    ],
    [
      "antigravity",
      ["PreToolUse", "PreToolUse.run_command"],
      ["Stop", "Stop.first"],
    ],
    [
      "opencode",
      ["tool.execute.before", "tool.execute.before.bash"],
      ["tool.execute.after", "tool.execute.after.bash"],
    ],
  ];

describe.each(CASES)(
  "sessions.mailbox on %s payloads",
  (runtime, before, after) => {
    const adapter = RUNTIMES[runtime];
    const policy = compiled(
      [guard("sessions.mailbox", "warn", { roles: {} })],
      {
        targets: [runtime],
      },
    );
    const event = ([native, name]: [string, string]) =>
      adapter.normalize(native, fixture(runtime, name), "/w")!;
    // Runs the before-tool event and, where needed, the delivering one; returns what the model saw.
    const turn = async (store: ReturnType<typeof scratchStore>) => {
      const first = event(before);
      const seen = [
        adapter.render(first, await decide(first, policy, { store })).stdout,
      ];
      if (after) {
        const next = event(after);
        seen.push(
          adapter.render(next, await decide(next, policy, { store })).stdout,
        );
      }
      return seen.join("\n");
    };

    // Only the runtimes that cannot show context before a tool hold it.
    if (after)
      it("holds the notice at the before-tool event and shows it at the next delivering one", async () => {
        const store = scratchStore({ mailbox: MAILBOX_ON });
        const { id } = store.mailbox.send({ from: {}, to: ["all"], body: "x" });
        const first = event(before);
        const held = adapter.render(
          first,
          await decide(first, policy, { store }),
        );
        expect(held.stdout).not.toContain(id);
        const next = event(after!);
        const shown = adapter.render(
          next,
          await decide(next, policy, { store }),
        );
        expect(shown.stdout).toContain(id);
      });

    it("delivers an unacknowledged message once, through the runtime's own channel", async () => {
      const store = scratchStore({ mailbox: MAILBOX_ON });
      const message = store.mailbox.send({
        from: { alias: "lead" },
        to: ["all"],
        subject: "lockfile",
        body: "Do not touch bun.lock today.",
        once: true,
      });
      const first = await turn(store);
      expect(first).toContain(message.id);
      expect(first).toContain("Do not touch bun.lock today.");
      expect(first).toContain("One-time request: act on it once");
      const session = event(before).session.id;
      // The notice names the recipient, so a command run inside the runtime acts as it.
      expect(first).toContain(`pmcp sessions ack <id> --session ${session}`);
      expect(first).toContain(`pmcp sessions reply <id> --session ${session}`);
      expect(
        store.mailbox.delivered(session.replace(/[^\w-]/gu, "_"), message.id),
      ).toBe(true);
      expect(
        store.mailbox.acked(session.replace(/[^\w-]/gu, "_"), message.id),
      ).toBe(false);
      expect(await turn(store)).not.toContain(message.id);
    });

    it("notices only new messages later, with a count of earlier unacknowledged ones", async () => {
      const store = scratchStore({ mailbox: MAILBOX_ON });
      store.mailbox.send({
        from: { alias: "lead" },
        to: ["all"],
        body: "first",
      });
      await turn(store);
      const second = store.mailbox.send({
        from: { alias: "lead" },
        to: ["all"],
        body: "second",
      });
      const seen = await turn(store);
      expect(seen).toContain(second.id);
      expect(seen).not.toContain(": first");
      expect(seen).toContain("1 earlier message(s) are still unacknowledged");
    });

    it("delivers a broadcast once as a message to all and marks it seen", async () => {
      const store = scratchStore({ mailbox: MAILBOX_ON });
      const posted = store.broadcast.post({
        by: "operator",
        text: "freeze at noon",
      });
      const policyBoth = compiled(
        [
          guard("sessions.mailbox", "warn", { roles: {} }),
          guard("sessions.broadcast", "warn"),
        ],
        { targets: [runtime] },
      );
      const first = event(before);
      const out = [
        adapter.render(first, await decide(first, policyBoth, { store }))
          .stdout,
      ];
      if (after) {
        const next = event(after);
        out.push(
          adapter.render(next, await decide(next, policyBoth, { store }))
            .stdout,
        );
      }
      const text = out.join("\n");
      expect(text.split("freeze at noon").length - 1).toBe(1);
      expect(store.registry.get(first.session.id)?.seenBroadcast).toBe(
        posted.id,
      );
    });
  },
);
