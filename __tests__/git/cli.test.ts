import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { readConfig } from "../../src/config.js";
import { readGitConfig } from "../../src/git/config.js";
import { commit, isolateGit, remote, sh } from "./fixture.js";

beforeAll(isolateGit);

function toml(dir: string, body: string): string {
  const path = join(dir, "pmcp.toml");
  writeFileSync(path, body);
  return path;
}

function quietUi(): { ui: Ui; out: string[] } {
  const out: string[] = [];
  const sink = { write: (text: string) => out.push(text) };
  return {
    ui: new Ui({ env: {}, quiet: true, stdout: sink, stderr: sink }),
    out,
  };
}

it("reads the mainline branch from [git.mainline] when mainline tables are present", () => {
  const dir = remote().base;
  const config = readGitConfig(
    readConfig(
      toml(
        dir,
        '[git]\nremote = "origin"\n[git.mainline]\nbranch = "trunk"\n[git.mainline.deliver]\nattempts = 5\n',
      ),
    ),
  );
  expect(config?.mainline).toBe("trunk");
  expect(config?.deliver?.attempts).toBe(5);
  expect(config?.sync).toBeUndefined();
});

it("treats a missing [git] table as off", () => {
  const dir = remote().base;
  expect(readGitConfig(readConfig(toml(dir, "[catalog]\n")))).toBeNull();
});

it("rejects an unknown key in a git table", () => {
  const dir = remote().base;
  expect(() =>
    readGitConfig(
      readConfig(toml(dir, "[git]\n[git.mainline.deliver]\nattemps = 2\n")),
    ),
  ).toThrow(/unknown key/u);
});

it("refuses pmcp git deliver when [git.mainline.deliver] is absent", async () => {
  const origin = remote();
  toml(origin.main, "[git]\n[git.worktrees]\n");
  const before = sh(origin.bare, "rev-parse", "main");
  commit(origin.main, "a.txt", "a\n", "add a");
  const { ui } = quietUi();
  expect(
    await dispatch(["git", "deliver"], {
      cwd: origin.main,
      ui,
      env: process.env,
    }),
  ).toBe(1);
  expect(sh(origin.bare, "rev-parse", "main")).toBe(before);
});

it("delivers through pmcp git deliver with the configured tables", async () => {
  const origin = remote();
  const state = join(origin.base, "state");
  toml(
    origin.main,
    `[sessions]\nstate_dir = "${state}"\n[git]\n[git.mainline.deliver]\nattempts = 2\n[git.mainline.sync]\n`,
  );
  commit(origin.main, "a.txt", "a\n", "add a");
  const { ui } = quietUi();
  expect(
    await dispatch(["git", "deliver"], {
      cwd: origin.main,
      ui,
      env: process.env,
    }),
  ).toBe(0);
  expect(sh(origin.bare, "log", "-1", "--format=%s", "main")).toBe("add a");
  expect(sh(origin.main, "rev-parse", "HEAD")).toBe(
    sh(origin.bare, "rev-parse", "main"),
  );
});
