import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compileHooks } from "../../../src/hooks/compile.js";
import { RUNTIMES } from "../../../src/hooks/runtimes/index.js";
import { compiled, decide, fixture, guard, scratchStore } from "../helpers.js";
import { policyFamilies } from "./_families.js";
import { projectionCases } from "./_projection.js";

projectionCases({
  runtime: "gemini",
  tools: ["gemini"],
  file: ".gemini/settings.json",
  peer: {
    content: `${JSON.stringify({ theme: "dark", hooks: { BeforeTool: [{ matcher: "x", hooks: [{ type: "command", command: "peer-guard" }] }] } })}\n`,
    kept: /peer-guard[\s\S]*|"theme": "dark"/u,
  },
  owned: /hook\.mjs gemini before_tool/u,
});

const gemini = RUNTIMES.gemini;
const root = "/rec/work/probe-gemini";

const tool = (name: string, input: Record<string, unknown>) => ({
  native: "BeforeTool",
  payload: {
    ...fixture("gemini", "BeforeTool.run_shell_command"),
    tool_name: name,
    tool_input: input,
  },
});

policyFamilies({
  runtime: "gemini",
  beforeTool: "BeforeTool",
  shell: (command) => tool("run_shell_command", { command }),
  edit: (path) => tool("write_file", { file_path: path, content: "x" }),
  refused: /"decision":"deny"/u,
});

describe("gemini adapter on recorded 0.63.0 payloads", () => {
  it("normalizes shell, edit, prompt and AfterAgent payloads", () => {
    const shell = gemini.normalize(
      "BeforeTool",
      fixture("gemini", "BeforeTool.run_shell_command"),
      root,
    )!;
    expect(shell).toMatchObject({
      runtime: "gemini",
      event: "before_tool",
      tool: {
        kind: "shell",
        native: "run_shell_command",
        command: "echo PROBE-OK-1",
      },
    });
    expect(shell.session.id).toBe("00000000-0000-4000-8000-000000000011");
    const edit = gemini.normalize(
      "BeforeTool",
      fixture("gemini", "BeforeTool.write_file"),
      root,
    )!;
    expect(edit.tool).toMatchObject({
      kind: "edit",
      paths: [`${root}/probe-edit.txt`],
    });
    const prompt = gemini.normalize(
      "BeforeAgent",
      fixture("gemini", "BeforeAgent"),
      root,
    )!;
    expect(prompt.event).toBe("prompt");
    expect(prompt.prompt).toMatch(/hook measurement run/u);
    const stop = gemini.normalize(
      "AfterAgent",
      fixture("gemini", "AfterAgent"),
      root,
    )!;
    expect(stop).toMatchObject({ event: "stop", stop: { active: false } });
    expect(gemini.normalize("BeforeModel", {}, root)).toBeNull();
  });

  it("writes deny as a top-level decision and context only where Gemini delivers it", () => {
    const before = gemini.normalize(
      "BeforeTool",
      fixture("gemini", "BeforeTool.run_shell_command.deny"),
      root,
    )!;
    expect(
      JSON.parse(
        gemini.render(before, { verdict: "deny", reason: "no" }).stdout,
      ),
    ).toEqual({
      decision: "deny",
      reason: "no",
    });
    const after = gemini.normalize(
      "AfterTool",
      fixture("gemini", "AfterTool.run_shell_command"),
      root,
    )!;
    expect(
      JSON.parse(gemini.render(after, { context: ["note"] }).stdout),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "AfterTool",
        additionalContext: "note",
      },
    });
  });

  it("holds BeforeTool context and delivers it with the next AfterTool", async () => {
    const store = scratchStore();
    store.broadcast.post({ by: "operator", text: "freeze at noon" });
    const policy = compiled([guard("sessions.broadcast", "warn")], {
      targets: ["gemini"],
    });
    const before = gemini.normalize(
      "BeforeTool",
      fixture("gemini", "BeforeTool.run_shell_command"),
      root,
    )!;
    const held = await decide(before, policy, { store });
    expect(held.context).toBeUndefined();
    const after = gemini.normalize(
      "AfterTool",
      fixture("gemini", "AfterTool.run_shell_command"),
      root,
    )!;
    const delivered = await decide(after, policy, { store });
    expect(delivered.context?.join("\n")).toMatch(/freeze at noon/u);
  });

  it("projects into .gemini/settings.json with millisecond timeouts and a regex matcher", (t) => {
    // A git checkout of its own with [git.shared_checkout] declared, so that guard is on.
    const repo = mkdtempSync(join(tmpdir(), "pmcp-gemini-projection-"));
    t.onTestFinished(() => rmSync(repo, { recursive: true, force: true }));
    execFileSync("git", ["init", "-q", repo]);
    const hooks = { targets: ["gemini"], guards: { shell: { heredoc: {} } } };
    const out = compileHooks(
      { hooks, git: { shared_checkout: {} } },
      { root: repo, tools: new Set(["gemini"]) },
    );
    // Undeclared, the shared checkout guard is off and only the shell tool is watched.
    const shellOnly = compileHooks(
      { hooks },
      { root: repo, tools: new Set(["gemini"]) },
    );
    expect(
      shellOnly.edits.find((edit) => edit.key[1] === "BeforeTool")!.entries[0],
    ).toMatchObject({ matcher: "^(run_shell_command)$" });
    const before = out.edits.find((edit) => edit.key[1] === "BeforeTool")!;
    expect(before.file).toBe(".gemini/settings.json");
    expect(before.entries[0]).toMatchObject({
      // Default-on guards also watch edits, so the edit tools join the shell tool.
      matcher: "^(run_shell_command|write_file|replace)$",
      hooks: [{ type: "command", name: "pmcp-before_tool", timeout: 10000 }],
    });
    expect(JSON.stringify(before.entries)).toMatch(
      /hook\.mjs gemini before_tool/u,
    );
    expect(out.policy?.lowering.gemini).toEqual({ ask: "deny" });
  });
});
