import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../src/config.js";
import { project } from "../src/project/apply.js";
import {
  evaluateShellHook,
  nativeHookDecision,
} from "../src/project/hook-adapter.js";
import { readSpec } from "../src/project/spec.js";

const targets =
  '[targets]\ntools = ["codex", "gemini", "antigravity", "grok"]\n';
const declaration =
  '[[hooks.shell]]\nname = "shell-policy"\ncommand = ["node", ".agents/guards/policy.mjs"]\ntargets = ["codex", "gemini", "antigravity"]\ntimeout_ms = 500\n';
const guard =
  'import { readFileSync } from "node:fs";\nconst input = JSON.parse(readFileSync(0, "utf8"));\nprocess.stdout.write(JSON.stringify({ decision: input.command.includes("DENY_FIXTURE") ? "deny" : "allow" }));\n';

function fixture(t: TestContext, source = declaration) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-hooks-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agents/guards"), { recursive: true });
  writeFileSync(join(root, ".agents/guards/policy.mjs"), guard);
  const config = join(root, "pmcp.toml");
  writeFileSync(config, targets + source);
  const apply = () => {
    const result = project(readSpec(readConfig(config)), { check: false });
    if (result.backup) {
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    }
    return result;
  };
  return { root, config, apply };
}

function json(root: string, file: string): any {
  return JSON.parse(readFileSync(join(root, file), "utf8"));
}

describe("opt-in native shell hooks", () => {
  it("preserves peer hooks and unrelated settings through regeneration and removal", (t) => {
    const { root, config, apply } = fixture(t);
    const peer = {
      matcher: "Write",
      hooks: [{ type: "command", command: "peer-guard" }],
    };
    mkdirSync(join(root, ".gemini"));
    writeFileSync(
      join(root, ".gemini/settings.json"),
      JSON.stringify({
        hooks: { BeforeTool: [peer] },
        context: { fileName: "AGENTS.md" },
      }),
    );
    expect(apply().code).toBe(0);
    const first = readFileSync(join(root, ".gemini/settings.json"), "utf8");
    expect(json(root, ".gemini/settings.json").hooks.BeforeTool[0]).toEqual(
      peer,
    );
    expect(apply().code).toBe(0);
    expect(readFileSync(join(root, ".gemini/settings.json"), "utf8")).toBe(
      first,
    );
    expect(project(readSpec(readConfig(config)), { check: true }).code).toBe(0);
    writeFileSync(config, targets);
    expect(apply().code).toBe(0);
    expect(json(root, ".gemini/settings.json")).toEqual({
      hooks: { BeforeTool: [peer] },
      context: { fileName: "AGENTS.md" },
    });
    expect(existsSync(join(root, ".agents/pmcp-hooks/adapter.mjs"))).toBe(
      false,
    );
    expect(apply().code).toBe(0);
    expect(json(root, ".gemini/settings.json").hooks.BeforeTool).toEqual([
      peer,
    ]);
  });

  it("generates no native hook files without a declaration", (t) => {
    const { root, apply } = fixture(t, "");
    expect(apply().code).toBe(0);
    expect(existsSync(join(root, ".codex/hooks.json"))).toBe(false);
    expect(existsSync(join(root, ".agents/hooks.json"))).toBe(false);
    expect(existsSync(join(root, ".grok/config.toml"))).toBe(false);
  });

  it("executes generated adapters from nested working directories on all initial targets", (t) => {
    const { root, apply } = fixture(t);
    expect(apply().code).toBe(0);
    mkdirSync(join(root, "nested"));
    const cases = [
      {
        tool: "codex",
        entry: json(root, ".codex/hooks.json").hooks.PreToolUse[0],
        payload: {
          tool_name: "Bash",
          tool_input: { command: "echo DENY_FIXTURE" },
        },
      },
      {
        tool: "gemini",
        entry: json(root, ".gemini/settings.json").hooks.BeforeTool[0],
        payload: {
          tool_name: "run_shell_command",
          tool_input: { command: "echo DENY_FIXTURE" },
        },
      },
      {
        tool: "antigravity",
        entry: json(root, ".agents/hooks.json")["pmcp-shell"].PreToolUse[0],
        payload: {
          toolCall: {
            name: "run_command",
            args: {
              CommandLine: JSON.stringify("echo DENY_FIXTURE"),
              Cwd: JSON.stringify(root),
            },
          },
        },
      },
    ];
    for (const entry of cases) {
      const result = execFileSync("sh", ["-c", entry.entry.hooks[0].command], {
        cwd: join(root, "nested"),
        input: JSON.stringify(entry.payload),
        encoding: "utf8",
      });
      const response = JSON.parse(result);
      expect(
        entry.tool === "codex"
          ? response.hookSpecificOutput.permissionDecision
          : response.decision,
      ).toBe("deny");
    }
  });

  it("denies stale guard content and updates the native hook fingerprint after projection", (t) => {
    const { root, apply } = fixture(t);
    expect(apply().code).toBe(0);
    const before = json(root, ".codex/hooks.json").hooks.PreToolUse[0].hooks[0]
      .command;
    writeFileSync(join(root, ".agents/guards/policy.mjs"), `${guard}\n`);
    const response = JSON.parse(
      execFileSync("sh", ["-c", before], {
        cwd: root,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo allowed" },
        }),
        encoding: "utf8",
      }),
    );
    expect(response.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(apply().code).toBe(0);
    expect(
      json(root, ".codex/hooks.json").hooks.PreToolUse[0].hooks[0].command,
    ).not.toBe(before);
  });

  it("refuses modified owned hook groups before changing another file", (t) => {
    const { root, apply } = fixture(t);
    expect(apply().code).toBe(0);
    const native = json(root, ".codex/hooks.json");
    native.hooks.PreToolUse[0].hooks[0].timeout = 999;
    writeFileSync(join(root, ".codex/hooks.json"), JSON.stringify(native));
    const gemini = readFileSync(join(root, ".gemini/settings.json"), "utf8");
    expect(() => apply()).toThrow("edited or removed");
    expect(readFileSync(join(root, ".gemini/settings.json"), "utf8")).toBe(
      gemini,
    );
  });

  it("backs up native configuration and adapter files before pruning", (t) => {
    const { root, config, apply } = fixture(t);
    expect(apply().code).toBe(0);
    writeFileSync(config, targets);
    const result = apply();
    expect(result.backup).toBeDefined();
    expect(
      existsSync(join(result.backup!, "files/.agents/pmcp-hooks/adapter.mjs")),
    ).toBe(true);
    expect(json(root, ".agents/hooks.json")).toEqual({});
  });

  for (const source of [
    declaration.replace('name = "shell-policy"', 'name = "Bad.Name"'),
    declaration.replace("timeout_ms = 500", "timeout_ms = 0"),
    declaration.replace('"codex", "gemini", "antigravity"', '"grok"'),
    declaration.replace("timeout_ms = 500", "unknown = true"),
    declaration + declaration,
    declaration.replace(
      ".agents/guards/policy.mjs",
      ".agents/guards/../../escape.mjs",
    ),
  ]) {
    it("rejects an invalid declaration before projection", (t) => {
      const { root, config } = fixture(t, source);
      expect(() => readSpec(readConfig(config))).toThrow();
      expect(existsSync(join(root, ".codex/hooks.json"))).toBe(false);
    });
  }

  it("rejects a guard symlink that resolves outside the policy directory", (t) => {
    const { root, config } = fixture(t);
    rmSync(join(root, ".agents/guards/policy.mjs"));
    writeFileSync(join(root, "outside.mjs"), guard);
    symlinkSync(
      join(root, "outside.mjs"),
      join(root, ".agents/guards/policy.mjs"),
    );
    expect(() => readSpec(readConfig(config))).toThrow("outside");
  });

  it("fails closed on malformed policy output and timeout while allowing non-shell tools", (t) => {
    const { root, config } = fixture(t);
    const policy = readSpec(readConfig(config)).hooks![0]!;
    const payload = {
      tool_name: "Bash",
      tool_input: { command: "echo allowed" },
    };
    writeFileSync(
      join(root, ".agents/guards/policy.mjs"),
      'process.stdout.write("invalid");',
    );
    expect(evaluateShellHook(root, policy, "codex", payload).decision).toBe(
      "deny",
    );
    writeFileSync(
      join(root, ".agents/guards/policy.mjs"),
      "setInterval(() => {}, 1000);",
    );
    expect(
      evaluateShellHook(root, { ...policy, timeoutMs: 100 }, "codex", payload)
        .decision,
    ).toBe("deny");
    expect(
      evaluateShellHook(root, policy, "codex", { tool_name: "apply_patch" })
        .decision,
    ).toBe("allow");
    expect(nativeHookDecision("antigravity", { decision: "allow" })).toEqual({
      decision: "allow",
    });
  });
});
