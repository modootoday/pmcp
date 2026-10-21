import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readConfig } from "../../../src/config.js";
import { compileHooks } from "../../../src/hooks/compile.js";
import { guestFor, RUNTIMES } from "../../../src/hooks/runtimes/index.js";
import { project } from "../../../src/project/apply.js";
import { readSpec } from "../../../src/project/spec.js";
import { compiled, decide, fixture, guard, scratchStore } from "../helpers.js";
import { policyFamilies } from "./_families.js";
import { projectionCases } from "./_projection.js";

const grok = RUNTIMES.grok;
const root = "/rec/work/probe-grok";

const call = (name: string, input: Record<string, unknown>) => ({
  native: "PreToolUse",
  payload: {
    ...fixture("grok", "PreToolUse.run_terminal_command"),
    toolName: name,
    toolInput: input,
    tool_name: name,
    tool_input: input,
  },
});

policyFamilies({
  runtime: "grok",
  beforeTool: "PreToolUse",
  shell: (command) => call("run_terminal_command", { command }),
  edit: (path) => call("write", { file_path: path, content: "x" }),
  refused: /"permissionDecision":"deny"/u,
});

projectionCases({
  runtime: "grok",
  tools: ["grok"],
  file: ".grok/hooks/pmcp.json",
  owned: /hook\.mjs grok before_tool/u,
});

describe("grok adapter on recorded 1.0.50 payloads", () => {
  it("normalizes the camelCase payload and takes the prompt id as the turn", () => {
    const shell = grok.normalize(
      "PreToolUse",
      fixture("grok", "PreToolUse.run_terminal_command"),
      root,
    )!;
    expect(shell).toMatchObject({
      runtime: "grok",
      session: { id: "00000000-0000-4000-8000-000000000012" },
      tool: { kind: "shell", command: "echo PROBE-OK-1" },
    });
    const edit = grok.normalize(
      "PreToolUse",
      fixture("grok", "PreToolUse.write"),
      root,
    )!;
    expect(edit.tool?.kind).toBe("edit");
    const stop = grok.normalize("Stop", fixture("grok", "Stop.active"), root)!;
    expect(stop.stop?.active).toBe(true);
    expect(stop.session.turnId).toBe("00000000-0000-4000-8000-000000000016");
  });

  it("claims grok calls made through the Claude projection, and only when grok is a target", () => {
    const compat = fixture("grok", "compat.PreToolUse.run_terminal_command");
    const claudeCall = fixture("claude", "PreToolUse.Bash");
    expect(guestFor(RUNTIMES.claude, compat, ["claude", "grok"]).id).toBe(
      "grok",
    );
    expect(guestFor(RUNTIMES.claude, claudeCall, ["claude", "grok"]).id).toBe(
      "claude",
    );
    expect(guestFor(RUNTIMES.claude, compat, ["claude"]).id).toBe("claude");
  });

  it("delivers context on tool events and an uncontinued Stop only", async () => {
    const store = scratchStore();
    store.broadcast.post({ by: "operator", text: "freeze at noon" });
    const policy = compiled([guard("sessions.broadcast", "warn")], {
      targets: ["grok"],
    });
    const start = grok.normalize(
      "SessionStart",
      fixture("grok", "SessionStart"),
      root,
    )!;
    const held = await decide(start, policy, { store });
    expect(held.context).toBeUndefined();
    const before = grok.normalize(
      "PreToolUse",
      fixture("grok", "PreToolUse.run_terminal_command"),
      root,
    )!;
    const out = JSON.parse(
      grok.render(before, await decide(before, policy, { store })).stdout,
    );
    expect(out.hookSpecificOutput.additionalContext).toMatch(/freeze at noon/u);
    const active = grok.normalize(
      "Stop",
      fixture("grok", "Stop.active"),
      root,
    )!;
    expect(grok.render(active, { context: ["x"] }).stdout).toBe("");
  });
});

describe("grok with claude also targeted", () => {
  it("projects into .claude/settings.json only, never also into .grok/hooks", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-grok-claude-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "pmcp.toml"),
      '[targets]\ntools = ["claude", "grok"]\n\n[hooks]\ntargets = ["claude", "grok"]\n\n[hooks.guards.shell.heredoc]\n',
    );
    const result = project(readSpec(readConfig(join(dir, "pmcp.toml"))), {
      check: false,
    });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    expect(result.code).toBe(0);
    const claude = existsSync(join(dir, ".claude/settings.json"))
      ? readFileSync(join(dir, ".claude/settings.json"), "utf8")
      : "";
    const grokFile = join(dir, ".grok/hooks/pmcp.json");
    // Both files carrying pmcp hooks would run every check twice under grok.
    expect(claude).toMatch(/hook\.mjs\\" claude before_tool/u);
    expect(existsSync(grokFile)).toBe(false);
  });

  it("compiles grok's policy but no grok edits", () => {
    const out = compileHooks(
      {
        hooks: {
          targets: ["claude", "grok"],
          guards: { shell: { heredoc: {} } },
        },
      },
      { root, tools: new Set(["claude", "grok"]) },
    );
    expect(out.policy?.targets).toEqual(["claude", "grok"]);
    expect(
      out.edits.every((edit) => edit.file === ".claude/settings.json"),
    ).toBe(true);
  });
});
