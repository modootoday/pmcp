import { describe, expect, it } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { cases, compiled, guard, runShell } from "../../helpers.js";

const RUNTIMES: RuntimeId[] = ["claude", "codex"];

const SIMPLE = [
  ["shell.in_place_edit", "in-place-edit"],
  ["shell.heredoc", "heredoc"],
  ["shell.compose_teardown", "compose-teardown"],
  ["shell.host_approval", "host-approval"],
  ["shell.runaway_regex", "runaway-regex"],
] as const;

describe.each(RUNTIMES)("shell guards on %s payloads", (runtime) => {
  for (const [id, file] of SIMPLE) {
    const { blocked, allowed } = cases("shell", file);
    it.each(blocked)(`${id} denies %s`, async (command) => {
      expect(
        (await runShell(runtime, compiled([guard(id)]), command)).verdict,
      ).toBe("deny");
    });
    it.each(allowed)(`${id} allows %s`, async (command) => {
      const outcome = await runShell(runtime, compiled([guard(id)]), command);
      expect(outcome.verdict).toBeUndefined();
      expect(outcome.stdout).toBe("");
    });
  }

  const stdin = cases("shell", "stdin-interpreter");
  const expectedAsk = runtime === "claude" ? "ask" : "deny";
  it.each(stdin.blocked)(
    `shell.stdin_interpreter asks (lowered on codex) for %s`,
    async (command) => {
      const outcome = await runShell(
        runtime,
        compiled([guard("shell.stdin_interpreter", "ask")]),
        command,
      );
      expect(outcome.verdict).toBe(expectedAsk);
    },
  );
  it.each(stdin.allowed)(
    "shell.stdin_interpreter allows %s",
    async (command) => {
      expect(
        (
          await runShell(
            runtime,
            compiled([guard("shell.stdin_interpreter", "ask")]),
            command,
          )
        ).verdict,
      ).toBeUndefined();
    },
  );

  const secret = cases("shell", "secret-exfiltration") as unknown as {
    options: Record<string, unknown>;
    ask: string[];
    deny: string[];
    allowed: string[];
  };
  const graded = compiled([
    guard("shell.secret_exfiltration", "graded", secret.options),
  ]);
  it.each(secret.ask)(
    "shell.secret_exfiltration grades a local read as ask: %s",
    async (command) => {
      expect((await runShell(runtime, graded, command)).verdict).toBe(
        expectedAsk,
      );
    },
  );
  it.each(secret.deny)(
    "shell.secret_exfiltration grades a wire send as deny: %s",
    async (command) => {
      expect((await runShell(runtime, graded, command)).verdict).toBe("deny");
    },
  );
  it.each(secret.allowed)(
    "shell.secret_exfiltration allows %s",
    async (command) => {
      expect(
        (await runShell(runtime, graded, command)).verdict,
      ).toBeUndefined();
    },
  );
});

describe("guard modes", () => {
  it("warn turns a refusal into context and never a verdict", async () => {
    const outcome = await runShell(
      "claude",
      compiled([guard("shell.heredoc", "warn")]),
      "cat <<EOF > f\nx\nEOF",
    );
    expect(outcome.verdict).toBeUndefined();
    expect(
      JSON.parse(outcome.stdout).hookSpecificOutput.additionalContext,
    ).toMatch(/pmcp shell\.heredoc/u);
  });

  it("deny wins over ask and keeps the denying reason", async () => {
    const policy = compiled([
      guard("shell.heredoc"),
      guard("shell.stdin_interpreter", "ask"),
    ]);
    const outcome = await runShell(
      "claude",
      policy,
      "python3 - << 'PY'\nprint(1)\nPY",
    );
    const out = JSON.parse(outcome.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toMatch(/Heredocs/u);
  });

  it("a command the classifier cannot read is still judged by text and refused", async () => {
    const outcome = await runShell(
      "claude",
      compiled([guard("shell.in_place_edit")]),
      "sed -i 's/a/b/ f",
    );
    expect(outcome.verdict).toBe("deny");
  });
});
