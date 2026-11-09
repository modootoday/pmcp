import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { compileHooks } from "../../src/hooks/compile.js";
import { readExternal } from "../../src/hooks/compile/external.js";
import type { CompiledExternal } from "../../src/hooks/compiled.js";
import type { EditRequest, HookInput } from "../../src/hooks/contract.js";
import { previewText } from "../../src/hooks/policies/external.js";
import { readBudgets } from "../../src/project/budgets.js";
import { compiled, decide, scratchStore } from "./helpers.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Reads the text from stdin with --stdin, else the file named last; BAD in it is a finding.
const CHECKER = `const fs = require("node:fs");
const args = process.argv.slice(2);
const text = args.includes("--stdin") ? fs.readFileSync(0, "utf8") : fs.readFileSync(args[args.length - 1], "utf8");
if (!text.includes("BAD")) process.exit(0);
process.stdout.write(JSON.stringify({ items: [{ rule: "B1", message: "over 10 lines", line: 2 }] }));
process.exit(1);
`;

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-external-"));
  roots.push(root);
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "check.cjs"), CHECKER);
  writeFileSync(join(root, "broken.cjs"), "process.exit(2);\n");
  writeFileSync(join(root, "notes/a.md"), "one\n");
  writeFileSync(join(root, "notes/bad.md"), "one\nBAD\n");
  return root;
}

function entry(
  mode: CompiledExternal["mode"],
  more: Partial<CompiledExternal> & { script?: string } = {},
): CompiledExternal {
  const { script = "check.cjs", ...rest } = more;
  const stdin = rest.stdin ? ["--stdin"] : [];
  return {
    name: "doc-size",
    paths: ["notes/**/*.md"],
    command: [process.execPath, script, ...stdin, "{path}"],
    timeoutMs: 60000,
    mode,
    ...rest,
  };
}

function edit(
  root: string,
  event: HookInput["event"],
  file: string,
  request?: Omit<EditRequest, "path">,
): HookInput {
  const path = join(root, file);
  return {
    contract: 2,
    runtime: "claude",
    event,
    session: { id: "abcd1234-session" },
    cwd: root,
    projectRoot: root,
    tool: {
      kind: "edit",
      native: "Edit",
      paths: [path],
      ...(request ? { edit: { path, ...request } } : {}),
    },
  };
}

const run = (
  input: HookInput,
  external: CompiledExternal,
  store = scratchStore(),
) => decide(input, compiled([], { external: [external] }), { store });

describe("[[hooks.guards.external]] before the write", () => {
  it("checks the whole new text on stdin and refuses it with the checker's items", async () => {
    const root = project();
    const denied = await run(
      edit(root, "before_tool", "notes/a.md", { content: "one\nBAD\n" }),
      entry("deny", { stdin: true }),
    );
    expect(denied.verdict).toBe("deny");
    expect(denied.reason).toContain("the check doc-size found 1 problem");
    expect(denied.reason).toContain("notes/a.md:2: B1: over 10 lines");
    expect(readFileSync(join(root, "notes/a.md"), "utf8")).toBe("one\n");
    const clean = await run(
      edit(root, "before_tool", "notes/a.md", { content: "two\n" }),
      entry("deny", { stdin: true }),
    );
    expect(clean.verdict).toBeUndefined();
  });

  it("rebuilds the text a replacement edit would leave, and does not check it again after", async () => {
    const root = project();
    const request = {
      replacements: [{ old: "one", new: "BAD", all: false }],
    };
    expect(
      previewText({ path: join(root, "notes/a.md"), ...request }, root),
    ).toBe("BAD\n");
    expect(
      (
        await run(
          edit(root, "before_tool", "notes/a.md", request),
          entry("deny", { stdin: true }),
        )
      ).verdict,
    ).toBe("deny");
    expect(
      (
        await run(
          edit(root, "after_tool", "notes/bad.md", {
            replacements: [{ old: "one", new: "two", all: false }],
          }),
          entry("deny", { stdin: true }),
        )
      ).verdict,
    ).toBeUndefined();
  });
});

describe("[[hooks.guards.external]] after the write", () => {
  it("checks the file on disk when the runtime cannot say what the edit writes", async () => {
    const root = project();
    expect(
      (
        await run(
          edit(root, "before_tool", "notes/bad.md"),
          entry("deny", { stdin: true }),
        )
      ).verdict,
    ).toBeUndefined();
    expect(
      (
        await run(
          edit(root, "after_tool", "notes/bad.md"),
          entry("deny", { stdin: true }),
        )
      ).verdict,
    ).toBe("deny");
  });

  it("without stdin runs only after the write and lets the checker read the file", async () => {
    const root = project();
    const external = entry("deny");
    expect(
      (
        await run(
          edit(root, "before_tool", "notes/bad.md", { content: "x" }),
          external,
        )
      ).verdict,
    ).toBeUndefined();
    expect(
      (await run(edit(root, "after_tool", "notes/bad.md"), external)).verdict,
    ).toBe("deny");
    expect(
      (await run(edit(root, "after_tool", "notes/a.md"), external)).verdict,
    ).toBeUndefined();
  });
});

describe("[[hooks.guards.external]] checker errors", () => {
  it("lets the edit through in deny mode unless on_error is deny", async () => {
    const root = project();
    const input = edit(root, "after_tool", "notes/a.md");
    expect(
      (await run(input, entry("deny", { script: "broken.cjs" }))).verdict,
    ).toBeUndefined();
    const closed = await run(
      input,
      entry("deny", { script: "broken.cjs", onError: "deny" }),
    );
    expect(closed.verdict).toBe("deny");
    expect(closed.reason).toContain("the check doc-size could not answer");
  });

  it("tells a warn session once, and observe never", async () => {
    const root = project();
    const store = scratchStore();
    const input = edit(root, "after_tool", "notes/a.md");
    const broken = entry("warn", { script: "broken.cjs" });
    const first = await run(input, broken, store);
    expect((first.context ?? []).join("\n")).toContain("could not answer");
    const second = await run(input, broken, store);
    expect(second.context ?? []).toEqual([]);
    const observed = await run(
      edit(root, "after_tool", "notes/bad.md"),
      entry("observe"),
    );
    expect(observed.verdict).toBeUndefined();
    expect(observed.context ?? []).toEqual([]);
  });
});

describe("[[hooks.guards.external]] configuration", () => {
  it("reads entries with observe and allow as defaults and refuses unknown fields", () => {
    expect(
      readExternal([
        { name: "b", paths: ["*.md"], command: ["spec"], stdin: true },
        { name: "a", paths: ["*.md"], command: ["spec"], mode: "off" },
      ]),
    ).toEqual([
      {
        name: "b",
        paths: ["*.md"],
        command: ["spec"],
        timeoutMs: 15000,
        mode: "observe",
        stdin: true,
      },
    ]);
    expect(() =>
      readExternal([{ name: "a", paths: ["*.md"], command: ["x"], on: "x" }]),
    ).toThrow(/unknown field on/u);
    expect(() =>
      readExternal([
        { name: "a", paths: ["*.md"], command: ["x"], on_error: "ask" },
      ]),
    ).toThrow(/on_error must be allow or deny/u);
    expect(() =>
      readExternal([{ name: "a", paths: ["/etc/*"], command: ["x"] }]),
    ).toThrow(/inside the project/u);
  });

  it("compiles into policy.json only when declared", () => {
    const root = project();
    const tools = new Set(["claude"]);
    expect(
      compileHooks(
        { hooks: { guards: { shell: { heredoc: {} } } } },
        { root, tools },
      ).policy?.external,
    ).toBeUndefined();
    expect(
      compileHooks(
        {
          hooks: {
            guards: {
              external: [
                {
                  name: "doc-size",
                  paths: ["notes/**"],
                  command: ["spec"],
                  on_error: "deny",
                },
              ],
            },
          },
        },
        { root, tools },
      ).policy?.external,
    ).toEqual([
      {
        name: "doc-size",
        paths: ["notes/**"],
        command: ["spec"],
        timeoutMs: 15000,
        mode: "observe",
        onError: "deny",
      },
    ]);
  });
});

describe("[budgets]", () => {
  it("keeps glob = { bytes, lines } for another checker and refuses anything else", () => {
    expect(
      readBudgets({
        "**/AGENTS.md": { bytes: 4096 },
        "MEMORY.md": { lines: 140, bytes: 20000 },
      }),
    ).toEqual({
      "**/AGENTS.md": { bytes: 4096 },
      "MEMORY.md": { lines: 140, bytes: 20000 },
    });
    expect(() => readBudgets({ "a.md": {} })).toThrow(
      /set bytes, lines or both/u,
    );
    expect(() => readBudgets({ "a.md": { bytes: 1, max: 2 } })).toThrow(
      /unknown key max/u,
    );
    expect(() => readBudgets({ "a.md": 4096 })).toThrow(/must be a table/u);
  });
});
