import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { workspace } from "./affected-fixture.js";
import { isolateGit } from "./fixture.js";

beforeAll(isolateGit);

function capture(): { ui: Ui; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    ui: new Ui({
      env: {},
      stdout: { write: (t: string) => out.push(t) },
      stderr: { write: (t: string) => err.push(t) },
    }),
    out,
    err,
  };
}

function scratchConfig(body: string): string {
  const path = join(
    mkdtempSync(join(tmpdir(), "pmcp-affected-config-")),
    "draft.toml",
  );
  writeFileSync(path, body);
  return path;
}

it("reads a --config file from outside the checkout and prints members", async () => {
  const ws = workspace();
  ws.write("packages/a/src/index.ts", "export const a = 2;\n");
  ws.write("docs/readme.md", "changed\n");
  ws.commit("edit");
  const path = scratchConfig(
    '[git.affected]\nunmapped = "report"\nconsumers = true\n',
  );
  const wide = capture();
  expect(
    await dispatch(["git", "affected", "--base", "HEAD~1", "--config", path], {
      cwd: ws.root,
      ui: wide.ui,
      env: process.env,
    }),
  ).toBe(0);
  expect(wide.out.join("")).toBe("packages/a\npackages/b\ntools/c\n");
  expect(wide.err.join("")).toContain("unmapped, not tested: docs/readme.md");
  const narrow = capture();
  await dispatch(
    ["git", "affected", "--base", "HEAD~1", "--tests-only", "--config", path],
    { cwd: ws.root, ui: narrow.ui, env: process.env },
  );
  expect(narrow.out.join("")).toBe("packages/a\n");
});

it("prints the versioned JSON shape", async () => {
  const ws = workspace();
  ws.write("packages/a/src/index.ts", "export const a = 2;\n");
  ws.commit("edit");
  const path = scratchConfig("[git.affected]\n");
  const io = capture();
  await dispatch(
    ["git", "affected", "--base", "HEAD~1", "--json", "--config", path],
    { cwd: ws.root, ui: io.ui, env: process.env },
  );
  const parsed = JSON.parse(io.out.join(""));
  expect(parsed).toMatchObject({
    schema: "pmcp.git.affected.v1",
    all: false,
    selected: ["packages/a"],
    changed: ["packages/a"],
  });
});

it("answers ALL with exit 0 when nothing describes the workspace", async () => {
  const ws = workspace();
  ws.write("packages/a/src/index.ts", "export const a = 2;\n");
  ws.commit("edit");
  const io = capture();
  const path = scratchConfig("[catalog]\n");
  expect(
    await dispatch(["git", "affected", "--base", "HEAD~1", "--config", path], {
      cwd: ws.root,
      ui: io.ui,
      env: process.env,
    }),
  ).toBe(0);
  expect(io.out.join("")).toBe("ALL\n");
  expect(io.err.join("")).toContain("[git.affected] is absent");
});

it("exits 2 on an unknown [git.affected] key or a missing --base", async () => {
  const ws = workspace();
  const io = capture();
  const path = scratchConfig('[git.affected]\nunmaped = "report"\n');
  expect(
    await dispatch(["git", "affected", "--base", "HEAD", "--config", path], {
      cwd: ws.root,
      ui: io.ui,
      env: process.env,
    }),
  ).toBe(2);
  expect(
    await dispatch(["git", "affected", "--config", path], {
      cwd: ws.root,
      ui: io.ui,
      env: process.env,
    }),
  ).toBe(2);
});
