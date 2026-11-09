import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { commit, isolateGit, remote, sh } from "./fixture.js";

beforeAll(isolateGit);

it("reports a linked worktree ahead of the mainline without exiting 4", async () => {
  const origin = remote();
  writeFileSync(
    join(origin.main, "pmcp.toml"),
    '[git.worktrees]\nroot = ".claude/worktrees"\n',
  );
  const desk = join(origin.main, ".claude/worktrees/review");
  sh(origin.main, "worktree", "add", "-q", "-b", "review", desk, "origin/main");
  commit(desk, "work.txt", "draft\n", "work in progress");
  const out: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: () => true },
    env: {},
  });
  const code = await dispatch(["status", "--json"], {
    ui,
    env: process.env,
    cwd: origin.main,
  });
  const data = JSON.parse(out.join("")).data;
  expect(data.worktrees).toMatchObject([{ alias: "review", ahead: 1 }]);
  expect(data.lagging).toBe(1);
  expect(data.drift).toBe(false);
  expect(code).toBe(0);
});
