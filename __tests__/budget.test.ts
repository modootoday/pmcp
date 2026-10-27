import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";
import { globPattern, readBudget } from "../src/project/budget.js";

function file(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

// A git project: a 3-line root AGENTS.md, CLAUDE.md a link to it, one package file and one
// file under a path the budget forbids.
function project(t: TestContext, budget: string): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-budget-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  file(root, "pmcp.toml", `[targets]\ntools = []\n${budget}`);
  file(root, "AGENTS.md", "one\ntwo\nthree\n");
  symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
  file(root, "packages/app/AGENTS.md", "x".repeat(50));
  file(root, "docs/adr/0001-choice.md", "decided\n");
  file(root, ".agents/skills/demo/SKILL.md", "---\nname: demo\n---\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
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

describe("[budget]", () => {
  it("passes project --check within every limit and shows the measurements in status", async (t) => {
    const root = project(
      t,
      '[budget]\nroot_bytes = 14\nroot_lines = 3\npackage_bytes = 50\nskills_max = 1\nforbid_paths = [".spec/**"]\n',
    );
    expect((await cli(root, "project", "--check")).code).toBe(0);
    const status = await cli(root, "status", "--json");
    expect(JSON.parse(status.out).budget).toEqual({
      rows: [
        { key: "root_bytes", subject: "AGENTS.md", value: 14, limit: 14 },
        { key: "root_lines", subject: "AGENTS.md", value: 3, limit: 3 },
        {
          key: "package_bytes",
          subject: "packages/app/AGENTS.md",
          value: 50,
          limit: 50,
        },
        { key: "skills_max", subject: ".agents/skills", value: 1, limit: 1 },
        { key: "forbid_paths", subject: ".spec/**", value: 0, limit: 0 },
      ],
      problems: [],
    });
  });

  it("fails project --check over a limit or on a forbidden path, and status shows it", async (t) => {
    const root = project(
      t,
      '[budget]\nroot_lines = 2\npackage_bytes = 49\nskills_max = 0\nforbid_paths = ["docs/adr"]\n',
    );
    const checked = await cli(root, "project", "--check");
    expect(checked.code).toBe(2);
    for (const line of [
      "[budget] root_lines: AGENTS.md is 3, over 2",
      "[budget] package_bytes: packages/app/AGENTS.md is 50, over 49",
      "[budget] skills_max: .agents/skills is 1, over 0",
      "[budget] forbid_paths: docs/adr/0001-choice.md matches docs/adr",
    ])
      expect(checked.out).toContain(line);
    const status = await cli(root, "status");
    expect(status.code).toBe(2);
    expect(status.out).toContain("Budget: 4 over");
  });

  it("leaves status unchanged without the table and refuses a bad one", async (t) => {
    const root = project(t, "");
    expect(
      JSON.parse((await cli(root, "status", "--json")).out),
    ).not.toHaveProperty("budget");
    expect(() => readBudget({ root_bytes: -1 })).toThrow(
      "[budget] root_bytes must be a whole number",
    );
    expect(() => readBudget({ size: 1 })).toThrow("unknown [budget] key size");
  });

  it("matches path globs by segment", () => {
    expect(globPattern("docs/adr").test("docs/adr/x.md")).toBe(true);
    expect(globPattern("**/.spec/**").test("a/b/.spec/c")).toBe(true);
    expect(globPattern("**/.spec/**").test(".spec/c")).toBe(true);
    expect(globPattern("*.md").test("a/b.md")).toBe(false);
    expect(globPattern("**/*.md").test("a/b.md")).toBe(true);
  });
});
