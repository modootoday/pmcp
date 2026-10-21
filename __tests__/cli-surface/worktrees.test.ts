import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readConfig } from "../../src/config.js";
import { desks } from "../../src/status/worktrees.js";
import { fixture } from "./helpers.js";

it("compares configured desks and excludes sibling feature worktrees without fetching", (t) => {
  const { root } = fixture(
    t,
    '[git]\nremote = "origin"\n[git.mainline]\nbranch = "main"\n[git.worktrees]\nroot = ".desks"\n',
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "fixture.txt"), "base");
  git("add", "--", "fixture.txt");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("worktree", "add", "-qb", "desk", join(root, ".desks/review"));
  git("worktree", "add", "-qb", "feature", join(root, "unrelated"));
  git("pack-refs", "--all");
  const rows = desks(readConfig(join(root, "pmcp.toml")));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    alias: "review",
    main: false,
    ahead: 0,
    behind: 0,
  });
  const desk = join(root, ".desks/review");
  writeFileSync(join(desk, "fixture.txt"), "ahead");
  execFileSync("git", ["-C", desk, "add", "--", "fixture.txt"]);
  execFileSync("git", [
    "-C",
    desk,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "desk",
  ]);
  expect(desks(readConfig(join(root, "pmcp.toml")))[0]?.ahead).toBe(1);
});
