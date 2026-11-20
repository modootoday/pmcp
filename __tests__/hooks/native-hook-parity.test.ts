// Parity verification between TS dispatch engine and native Rust hotpath hook.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  evaluateNativeHook,
  resolveNativeHookBinary,
  toDecision,
} from "../../src/hooks/native-hook.js";
import { cases, compiled, guard, runShell } from "./helpers.js";

describe("native-hook bridge fallback", () => {
  it("resolves null when PMCP_HOOK_BIN points to non-existent file", () => {
    expect(
      resolveNativeHookBinary({
        PMCP_HOOK_BIN: "/tmp/non_existent_pmcp_hook_binary_path",
      }),
    ).toBeNull();
  });

  it("returns null fallback when binary is absent", () => {
    const policy = compiled([guard("shell.in_place_edit")]);
    const result = evaluateNativeHook(
      policy,
      {
        runtime: "claude",
        event: "before_tool",
        command: "sed -i 's/a/b/' file.txt",
      },
      { binaryPath: "/tmp/non_existent_pmcp_hook_binary_path" },
    );
    expect(result).toBeNull();
  });

  it("converts native hook responses to decision structure", () => {
    expect(toDecision({ verdict: "allow", delegate: false })).toEqual({});
    expect(
      toDecision({
        verdict: "deny",
        guard: "shell.in_place_edit",
        reason: "in-place edit",
        delegate: false,
      }),
    ).toEqual({
      verdict: "deny",
      reason: "in-place edit",
    });
    expect(
      toDecision({
        verdict: "ask",
        guard: "shell.stdin_interpreter",
        reason: "stdin script",
        delegate: false,
      }),
    ).toEqual({
      verdict: "ask",
      reason: "stdin script",
    });
    expect(
      toDecision({
        verdict: "warn",
        guard: "shell.runaway_regex",
        reason: "potential runaway pattern",
        delegate: false,
      }),
    ).toEqual({
      context: ["pmcp shell.runaway_regex: potential runaway pattern"],
    });
  });
});

const debugBinary = join(
  import.meta.dirname,
  "../../crates/pmcp-hook/target/debug/pmcp-hook",
);
const hasBinary = existsSync(debugBinary);

describe.runIf(hasBinary)("native-hook parity with TS policy engine", () => {
  const binaryOptions = { binaryPath: debugBinary };

  describe("shell guards parity", () => {
    const SIMPLE_GUARDS = [
      ["shell.in_place_edit", "in-place-edit"],
      ["shell.heredoc", "heredoc"],
      ["shell.compose_teardown", "compose-teardown"],
      ["shell.runaway_regex", "runaway-regex"],
      ["shell.self_matching_wait", "self-matching-wait"],
    ] as const;

    for (const [guardId, fixtureFile] of SIMPLE_GUARDS) {
      const { blocked, allowed } = cases("shell", fixtureFile);

      it(`matches deny verdicts for ${guardId}`, async () => {
        const policy = compiled([guard(guardId)]);
        for (const cmd of blocked) {
          const tsOutcome = await runShell("claude", policy, cmd);
          const nativeOutcome = evaluateNativeHook(
            policy,
            { runtime: "claude", event: "before_tool", command: cmd },
            binaryOptions,
          );
          expect(tsOutcome.verdict).toBe("deny");
          expect(nativeOutcome?.verdict).toBe("deny");
          expect(nativeOutcome?.guard).toBe(guardId);
        }
      });

      it(`matches allow verdicts for ${guardId}`, async () => {
        const policy = compiled([guard(guardId)]);
        for (const cmd of allowed) {
          const tsOutcome = await runShell("claude", policy, cmd);
          const nativeOutcome = evaluateNativeHook(
            policy,
            { runtime: "claude", event: "before_tool", command: cmd },
            binaryOptions,
          );
          expect(tsOutcome.verdict).toBeUndefined();
          expect(nativeOutcome?.verdict).toBe("allow");
        }
      });
    }

    it("matches lowering behavior for shell.stdin_interpreter", async () => {
      const stdin = cases("shell", "stdin-interpreter");
      const policyClaude = compiled([guard("shell.stdin_interpreter", "ask")]);
      const policyCodex = compiled([guard("shell.stdin_interpreter", "ask")], {
        lowering: { codex: { ask: "deny" } },
      });

      for (const cmd of stdin.blocked) {
        const claudeNative = evaluateNativeHook(
          policyClaude,
          { runtime: "claude", event: "before_tool", command: cmd },
          binaryOptions,
        );
        expect(claudeNative?.verdict).toBe("ask");

        const codexNative = evaluateNativeHook(
          policyCodex,
          { runtime: "codex", event: "before_tool", command: cmd },
          binaryOptions,
        );
        expect(codexNative?.verdict).toBe("deny");
      }
    });
  });

  describe("git guards parity", () => {
    it("matches git.push_without_verify verdicts", async () => {
      const { blocked, allowed } = cases("git", "push-without-verify");
      const policy = compiled([guard("git.push_without_verify")]);

      for (const cmd of blocked) {
        const tsOutcome = await runShell("claude", policy, cmd);
        const nativeOutcome = evaluateNativeHook(
          policy,
          { runtime: "claude", event: "before_tool", command: cmd },
          binaryOptions,
        );
        expect(tsOutcome.verdict).toBe("deny");
        expect(nativeOutcome?.verdict).toBe("deny");
      }

      for (const cmd of allowed) {
        const tsOutcome = await runShell("claude", policy, cmd);
        const nativeOutcome = evaluateNativeHook(
          policy,
          { runtime: "claude", event: "before_tool", command: cmd },
          binaryOptions,
        );
        expect(tsOutcome.verdict).toBeUndefined();
        expect(nativeOutcome?.verdict).toBe("allow");
      }
    });

    it("matches git.gate_bypass_env verdicts", async () => {
      const fixture = cases("git", "gate-bypass-env");
      const policy = compiled([
        guard(
          "git.gate_bypass_env",
          "deny",
          (fixture as { options?: Record<string, unknown> }).options ?? {
            names: [
              "ACME_ALLOW_DIRECT_PUSH",
              "ACME_GATE_LOCK_HELD",
              "ACME_GATE_IN_PLACE",
            ],
          },
        ),
      ]);

      for (const cmd of fixture.blocked) {
        const tsOutcome = await runShell("claude", policy, cmd);
        const nativeOutcome = evaluateNativeHook(
          policy,
          { runtime: "claude", event: "before_tool", command: cmd },
          binaryOptions,
        );
        expect(tsOutcome.verdict).toBe("deny");
        expect(nativeOutcome?.verdict).toBe("deny");
      }

      for (const cmd of fixture.allowed) {
        const tsOutcome = await runShell("claude", policy, cmd);
        const nativeOutcome = evaluateNativeHook(
          policy,
          { runtime: "claude", event: "before_tool", command: cmd },
          binaryOptions,
        );
        expect(tsOutcome.verdict).toBeUndefined();
        expect(nativeOutcome?.verdict).toBe("allow");
      }
    });

    it("matches git.forced_branch_move and git.mainline.deliver", () => {
      const policy = compiled([
        guard("git.forced_branch_move"),
        guard("git.mainline.deliver"),
      ]);

      const moveRes = evaluateNativeHook(
        policy,
        {
          runtime: "claude",
          event: "before_tool",
          command: "git branch -f main HEAD",
        },
        binaryOptions,
      );
      expect(moveRes?.verdict).toBe("deny");

      const pushMainRes = evaluateNativeHook(
        policy,
        {
          runtime: "claude",
          event: "before_tool",
          command: "git push origin HEAD:main",
          mainline_branch: "main",
        },
        binaryOptions,
      );
      expect(pushMainRes?.verdict).toBe("deny");
    });
  });

  describe("delegation handling", () => {
    it("returns null to delegate when external or custom guards are present", () => {
      const policyWithCustom = compiled([guard("shell.in_place_edit")], {
        custom: [
          {
            name: "custom-test",
            command: ["echo", "test"],
            event: "stop",
            targets: ["claude"],
            timeoutMs: 1000,
          },
        ],
      });

      const result = evaluateNativeHook(
        policyWithCustom,
        { runtime: "claude", event: "before_tool", command: "ls -la" },
        binaryOptions,
      );
      expect(result).toBeNull();
    });
  });
});
