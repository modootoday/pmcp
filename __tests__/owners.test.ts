import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";
import { compileHooks } from "../src/hooks/compile.js";
import type { HookInput } from "../src/hooks/contract.js";
import { ownerNotices, ownersOf, readOwners } from "../src/hooks/owners.js";
import { compiled, decide, scratchStore } from "./hooks/helpers.js";

const OWNERS = [
  {
    paths: ["services/auth", "services/billing/**/*.ts"],
    owner: "hub team",
    note: "tell them first",
  },
  { paths: ["docs/**"], owner: "writers", mode: "observe" },
];

function project(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-owners-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "pmcp.toml"),
    '[[owners]]\npaths = ["services/auth"]\nowner = "hub team"\nnote = "tell them first"\n',
  );
  mkdirSync(join(root, "services/auth"), { recursive: true });
  return root;
}

async function cli(root: string, ...args: string[]) {
  let out = "";
  const ui = new Ui({
    stdout: { write: (text) => void (out += text) },
    stderr: { write: (text) => void (out += text) },
  });
  const code = await dispatch(args, {
    cwd: root,
    env: { HOME: root, XDG_STATE_HOME: join(root, ".xdg") },
    ui,
  });
  return { code, out };
}

function edit(root: string, session: string, ...files: string[]): HookInput {
  return {
    contract: 2,
    runtime: "claude",
    event: "after_tool",
    session: { id: session },
    cwd: root,
    projectRoot: root,
    tool: {
      kind: "edit",
      native: "Edit",
      paths: files.map((file) => join(root, file)),
    },
  };
}

describe("[[owners]]", () => {
  it("matches globs and names each warn owner once with how many more paths", () => {
    const entries = readOwners(OWNERS);
    expect(ownersOf(entries, "services/auth/src/a.ts")[0]?.owner).toBe(
      "hub team",
    );
    expect(ownersOf(entries, "services/billing/x.md")).toEqual([]);
    expect(
      ownerNotices(entries, [
        "services/auth/b.ts",
        "services/auth/a.ts",
        "docs/x.md",
        "README.md",
      ]),
    ).toEqual([
      "services/auth/a.ts belongs to hub team: tell them first (and 1 more)",
    ]);
    expect(() =>
      readOwners([{ paths: ["a"], owner: "x", mode: "deny" }]),
    ).toThrow(/mode must be warn or observe/u);
    expect(() => readOwners([{ paths: ["../a"], owner: "x" }])).toThrow(
      /inside the project/u,
    );
  });

  it("tells an editing session once per owner and never refuses", async () => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-owners-hook-"));
    const policy = compiled([
      { id: "owners", mode: "warn", options: { entries: readOwners(OWNERS) } },
    ]);
    const store = scratchStore();
    const first = await decide(
      edit(root, "abcd1234-session-1", "services/auth/a.ts", "docs/x.md"),
      policy,
      { store },
    );
    expect(first.verdict).toBeUndefined();
    expect(first.context).toEqual([
      "pmcp owners: services/auth/a.ts belongs to hub team: tell them first",
    ]);
    const again = await decide(
      edit(root, "abcd1234-session-1", "services/auth/b.ts"),
      policy,
      { store },
    );
    expect(again.context ?? []).toEqual([]);
    const other = await decide(
      edit(root, "abcd1234-session-2", "README.md"),
      policy,
      { store },
    );
    expect(other.context ?? []).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("projects the hook bundle when declared", () => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-owners-compile-"));
    const hooks = compileHooks(
      { owners: OWNERS },
      { root, tools: new Set(["claude"]) },
    );
    expect(hooks.policy?.guards.map((guard) => guard.id)).toContain("owners");
    expect(
      compileHooks({}, { root, tools: new Set(["claude"]) }).policy,
    ).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("answers pmcp owners for paths, as text and as JSON", async (t) => {
    const root = project(t);
    const text = await cli(root, "owners", "services/auth/x.ts", "README.md");
    expect(text.code).toBe(0);
    expect(text.out).toContain(
      "services/auth/x.ts belongs to hub team: tell them first",
    );
    expect(text.out).toContain("README.md: no owner");
    const json = JSON.parse(
      (await cli(root, "owners", "services/auth", "--json")).out,
    );
    expect(json.data).toEqual({
      version: 1,
      paths: [
        {
          path: "services/auth",
          owners: [
            { owner: "hub team", note: "tell them first", mode: "warn" },
          ],
        },
      ],
    });
    expect((await cli(root, "owners")).code).toBe(2);
  });
});
