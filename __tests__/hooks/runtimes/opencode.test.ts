import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, type TestContext } from "vitest";

import { compileHooks } from "../../../src/hooks/compile.js";
import { RUNTIMES } from "../../../src/hooks/runtimes/index.js";
import { compiled, decide, fixture, guard, scratchStore } from "../helpers.js";
import { policyFamilies } from "./_families.js";
import { projectionCases } from "./_projection.js";

const opencode = RUNTIMES.opencode;
const root = "/rec/work/probe-opencode";

const call = (tool: string, args: Record<string, unknown>) => ({
  native: "tool.execute.before",
  payload: {
    input: {
      ...fixture("opencode", "tool.execute.before.bash")["input"],
      tool,
    },
    args,
  },
});

policyFamilies({
  runtime: "opencode",
  beforeTool: "tool.execute.before",
  shell: (command) => call("bash", { command }),
  edit: (path) => call("write", { filePath: path, content: "x" }),
  refused: /"deny":/u,
});

projectionCases({
  runtime: "opencode",
  tools: ["opencode"],
  file: ".opencode/plugins/pmcp.js",
  owned: /"before_tool":10000/u,
});

describe("opencode adapter on recorded 1.18.33 hook inputs", () => {
  it("normalizes tool, prompt and bus-event payloads", () => {
    const shell = opencode.normalize(
      "tool.execute.before",
      fixture("opencode", "tool.execute.before.bash"),
      root,
    )!;
    expect(shell).toMatchObject({
      event: "before_tool",
      session: { id: "ses_00000001" },
      tool: { kind: "shell", command: "echo PROBE-OK-1" },
    });
    const edit = opencode.normalize(
      "tool.execute.before",
      fixture("opencode", "tool.execute.before.write"),
      root,
    )!;
    expect(edit.tool).toMatchObject({
      kind: "edit",
      paths: [`${root}/probe-edit.txt`],
    });
    const idle = opencode.normalize(
      "session.idle",
      fixture("opencode", "session.idle"),
      root,
    )!;
    expect(idle).toMatchObject({
      event: "stop",
      session: { id: "ses_00000001" },
    });
    expect(
      opencode.normalize(
        "session.created",
        fixture("opencode", "session.created"),
        root,
      )?.event,
    ).toBe("session_start");
  });

  it("holds before_tool context for the tool output and keeps Stop silent", async () => {
    const store = scratchStore();
    store.broadcast.post({ by: "operator", text: "freeze at noon" });
    const policy = compiled([guard("sessions.broadcast", "warn")], {
      targets: ["opencode"],
    });
    const before = opencode.normalize(
      "tool.execute.before",
      fixture("opencode", "tool.execute.before.bash"),
      root,
    )!;
    expect(
      opencode.render(before, await decide(before, policy, { store })).stdout,
    ).toBe("{}\n");
    const after = opencode.normalize(
      "tool.execute.after",
      fixture("opencode", "tool.execute.after.bash"),
      root,
    )!;
    const out = JSON.parse(
      opencode.render(after, await decide(after, policy, { store })).stdout,
    );
    expect(out.context).toMatch(/freeze at noon/u);
    const idle = opencode.normalize(
      "session.idle",
      fixture("opencode", "session.idle"),
      root,
    )!;
    expect(opencode.render(idle, { context: ["x"] }).stdout).toBe("{}\n");
  });

  it("projects the plugin file only, with no hook configuration edits", () => {
    const out = compileHooks(
      { hooks: { targets: ["opencode"], guards: { shell: { heredoc: {} } } } },
      { root, tools: new Set(["opencode"]) },
    );
    expect(out.edits).toEqual([]);
    expect(out.files.map((file) => file.path)).toEqual([
      ".opencode/plugins/pmcp.js",
    ]);
    expect(out.policy?.lowering.opencode).toEqual({ ask: "deny" });
  });
});

// Runs the generated plugin against a stand-in hook.mjs to check the wiring opencode will load.
describe("the generated opencode plugin", () => {
  function scratch(t: TestContext, hook: string) {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-opencode-plugin-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, ".agents/pmcp-hooks"), { recursive: true });
    mkdirSync(join(dir, ".opencode/plugins"), { recursive: true });
    writeFileSync(join(dir, ".agents/pmcp-hooks/hook.mjs"), hook);
    const [plugin] = opencode.files!({
      bindings: ["before_tool", "after_tool", "prompt", "stop"].map(
        (event) => ({
          event: event as "before_tool",
          native: "x",
          timeoutSec: 5,
        }),
      ),
    });
    writeFileSync(join(dir, plugin!.path), plugin!.content);
    return join(dir, plugin!.path);
  }

  const answering =
    'import { readFileSync } from "node:fs";\n' +
    "const [, , , event] = process.argv;\n" +
    'const payload = JSON.parse(readFileSync(0, "utf8"));\n' +
    'const command = payload.args?.command ?? "";\n' +
    "let out = {};\n" +
    'if (event === "before_tool" && command.includes("DENY")) out = { deny: "no heredocs" };\n' +
    'if (event === "after_tool" || event === "prompt") out = { context: `note for ${event}` };\n' +
    "process.stdout.write(JSON.stringify(out));\n";

  it("throws the deny reason, appends after-tool context and keeps prompt context for the whole turn", async (t) => {
    const file = scratch(t, answering);
    const { Pmcp } = await import(pathToFileURL(file).href);
    const hooks = await Pmcp({ directory: "/w" });
    const input = { tool: "bash", sessionID: "s1", callID: "c1" };
    await expect(
      hooks["tool.execute.before"](input, { args: { command: "DENY it" } }),
    ).rejects.toThrow("no heredocs");
    await hooks["tool.execute.before"](input, { args: { command: "ls" } });
    const output = { output: "done" };
    await hooks["tool.execute.after"](input, output);
    expect(output.output).toBe("done\n\nnote for after_tool");
    // Each model call builds its own system prompt; opencode's first call of a turn is a small
    // title call, so the note must reach the later main call too (live 1.18.33 finding).
    const call = async () => {
      const system: string[] = [];
      await hooks["experimental.chat.system.transform"](
        { sessionID: "s1" },
        { system },
      );
      return system;
    };
    await hooks["chat.message"]({ sessionID: "s1" }, {});
    expect(await call()).toEqual(["note for prompt"]);
    expect(await call()).toEqual(["note for prompt"]);
    await hooks["chat.message"]({ sessionID: "s1" }, {});
    expect(await call()).toEqual(["note for prompt"]);
    expect(await call()).toEqual(["note for prompt"]);
  });

  it("refuses a tool call when the hook cannot answer", async (t) => {
    const file = scratch(t, "process.exit(3);\n");
    const { Pmcp } = await import(pathToFileURL(file).href);
    const hooks = await Pmcp({ directory: "/w" });
    await expect(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        { args: { command: "ls" } },
      ),
    ).rejects.toThrow("did not answer");
  });
});
