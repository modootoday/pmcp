import { describe, expect, it } from "vitest";

import { compileHooks } from "../../../src/hooks/compile.js";
import { RUNTIMES } from "../../../src/hooks/runtimes/index.js";
import { compiled, decide, fixture, guard, scratchStore } from "../helpers.js";
import { policyFamilies } from "./_families.js";
import { projectionCases } from "./_projection.js";

const agy = RUNTIMES.antigravity;
const root = "/rec/work/probe-agy";

const call = (name: string, args: Record<string, unknown>) => ({
  native: "PreToolUse",
  payload: {
    ...fixture("antigravity", "PreToolUse.run_command"),
    toolCall: { name, args },
  },
});

policyFamilies({
  runtime: "antigravity",
  beforeTool: "PreToolUse",
  shell: (command) => call("run_command", { CommandLine: command, Cwd: root }),
  edit: (path) =>
    call("write_to_file", { TargetFile: `${root}/${path}`, CodeContent: "x" }),
  refused: /"decision":"deny"/u,
});

projectionCases({
  runtime: "antigravity",
  tools: ["antigravity"],
  file: ".agents/hooks.json",
  peer: {
    content: `${JSON.stringify({ team: { Stop: [{ type: "command", command: "peer-guard" }] } })}\n`,
    kept: /peer-guard/u,
  },
  owned: /hook\.mjs antigravity before_tool/u,
});

describe("antigravity adapter on recorded 1.3.3 payloads", () => {
  it("reads the conversation id, the tool cwd and the edited file", () => {
    const shell = agy.normalize(
      "PreToolUse",
      fixture("antigravity", "PreToolUse.run_command"),
      "/elsewhere",
    )!;
    expect(shell).toMatchObject({
      event: "before_tool",
      session: { id: "00000000-0000-4000-8000-000000000001" },
      cwd: root,
      tool: { kind: "shell", command: "echo PROBE-OK-1" },
    });
    const edit = agy.normalize(
      "PreToolUse",
      fixture("antigravity", "PreToolUse.write_to_file"),
      root,
    )!;
    expect(edit.tool).toMatchObject({
      kind: "edit",
      paths: [`${root}/probe-edit.txt`],
    });
  });

  it("reads session start, prompt and continued Stop from the counters", () => {
    const first = fixture("antigravity", "PreInvocation.first");
    expect(agy.normalize("PreInvocation", first, root)?.event).toBe(
      "session_start",
    );
    const resumed = { ...first, initialNumSteps: 9 };
    expect(agy.normalize("PreInvocation", resumed, root)?.event).toBe("prompt");
    expect(
      agy.normalize(
        "PreInvocation",
        fixture("antigravity", "PreInvocation.later"),
        root,
      ),
    ).toBeNull();
    const stop = (name: string) =>
      agy.normalize("Stop", fixture("antigravity", name), root)!;
    expect(stop("Stop.first").stop).toEqual({ active: false });
    expect(stop("Stop.continued").stop).toEqual({ active: true });
  });

  it("always names a decision before a tool, since agy denies on silence", () => {
    const before = agy.normalize(
      "PreToolUse",
      fixture("antigravity", "PreToolUse.run_command"),
      root,
    )!;
    expect(JSON.parse(agy.render(before, {}).stdout)).toEqual({
      decision: "allow",
    });
    expect(JSON.parse(agy.silent!("before_tool"))).toEqual({
      decision: "allow",
    });
    expect(JSON.parse(agy.silent!("stop"))).toEqual({});
  });

  it("delivers context through injectSteps and an uncontinued Stop only", async () => {
    const store = scratchStore();
    store.broadcast.post({ by: "operator", text: "freeze at noon" });
    const policy = compiled([guard("sessions.broadcast", "warn")], {
      targets: ["antigravity"],
    });
    const before = agy.normalize(
      "PreToolUse",
      fixture("antigravity", "PreToolUse.run_command"),
      root,
    )!;
    expect((await decide(before, policy, { store })).context).toBeUndefined();
    const continued = agy.normalize(
      "Stop",
      fixture("antigravity", "Stop.continued"),
      root,
    )!;
    expect(
      agy.render(continued, await decide(continued, policy, { store })).stdout,
    ).toBe("{}\n");
    const stop = agy.normalize(
      "Stop",
      fixture("antigravity", "Stop.first"),
      root,
    )!;
    const out = JSON.parse(
      agy.render(stop, await decide(stop, policy, { store })).stdout,
    );
    expect(out).toMatchObject({ decision: "continue" });
    expect(out.reason).toMatch(/freeze at noon/u);
    const start = agy.normalize(
      "PreInvocation",
      fixture("antigravity", "PreInvocation.first"),
      root,
    )!;
    expect(JSON.parse(agy.render(start, { context: ["note"] }).stdout)).toEqual(
      { injectSteps: [{ ephemeralMessage: "note" }] },
    );
  });

  it("projects one named set with a single PreInvocation entry", () => {
    const out = compileHooks(
      {
        hooks: { targets: ["antigravity"], guards: { shell: { heredoc: {} } } },
        sessions: { registry: {}, broadcast: {} },
      },
      { root, tools: new Set(["antigravity"]) },
    );
    expect(new Set(out.edits.map((edit) => edit.key[0]))).toEqual(
      new Set(["pmcp"]),
    );
    const invocations = out.edits.filter(
      (edit) => edit.key[1] === "PreInvocation",
    );
    expect(invocations).toHaveLength(1);
    expect(invocations[0]!.entries).toHaveLength(1);
    const before = out.edits.find((edit) => edit.key[1] === "PreToolUse")!;
    expect(before.entries[0]).toMatchObject({ matcher: "*" });
    expect(out.policy?.lowering.antigravity).toEqual({ ask: "deny" });
  });
});
