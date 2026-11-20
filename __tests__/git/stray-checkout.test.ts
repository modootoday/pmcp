import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
import { syncMainline } from "../../src/git/mainline/sync.js";
import { cleanStrayCheckouts, followPins } from "../../src/git/submodules.js";
import { syncWorktree } from "../../src/git/worktrees/sync.js";
import {
  clone,
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

// Sets up a repository where origin advances without submodule changes, while a clone
// has a stray submodule checkout that has no gitlink in HEAD.
function strayFixture(): {
  origin: Remote;
  behind: string;
  before: string;
  after: string;
  dir: string;
  lib: Remote;
} {
  const origin = remote();
  const lib = remote();
  const seed = clone(origin, "seed-parent");
  commit(seed, "base.txt", "base\n", "base commit");
  sh(seed, "push", "-q", "origin", "HEAD:main");

  const behind = clone(origin, "behind");
  const before = sh(behind, "rev-parse", "HEAD");

  // Advance origin with an ordinary commit; no submodule gitlinks are touched
  commit(seed, "next.txt", "next\n", "advance mainline");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(behind, "fetch", "-q", "origin");
  const after = sh(behind, "rev-parse", "origin/main");

  // Create a stray submodule checkout in behind whose gitlink is not tracked in HEAD
  sh(behind, "submodule", "add", "-q", lib.bare, "stray");
  sh(behind, "reset", "-q", "HEAD", "stray");
  rmSync(join(behind, ".gitmodules"), { force: true });

  return { origin, behind, before, after, dir: join(behind, "stray"), lib };
}

// Moves the parent checkout to target without submodule recursion
function move(checkout: string, target: string): void {
  sh(
    checkout,
    "-c",
    "submodule.recurse=false",
    "merge",
    "-q",
    "--ff-only",
    target,
  );
}

describe("stray submodule checkout cleanup on sync", () => {
  it("removes a stray submodule checkout when clean and pushed to origin", () => {
    const { behind, before, after, dir } = strayFixture();
    move(behind, after);
    expect(existsSync(dir)).toBe(true);
    const lines = followPins(behind, before, after);
    expect(lines).toEqual([
      "stray: removed: its gitlink is gone, and its checkout was clean with every commit on its origin",
    ]);
    expect(existsSync(dir)).toBe(false);
  });

  it("preserves a stray submodule checkout when it has uncommitted changes", () => {
    const { behind, before, after, dir } = strayFixture();
    move(behind, after);
    writeFileSync(join(dir, "draft.txt"), "draft\n");
    expect(followPins(behind, before, after)).toEqual([
      "stray: left as an untracked directory: its gitlink is gone, but it has uncommitted changes",
    ]);
    expect(existsSync(join(dir, "draft.txt"))).toBe(true);
  });

  it("preserves a stray submodule checkout when it holds commits missing on origin", () => {
    const { behind, before, after, dir } = strayFixture();
    move(behind, after);
    commit(dir, "local.txt", "local\n", "local unpushed");
    expect(followPins(behind, before, after)).toEqual([
      "stray: left as an untracked directory: its gitlink is gone, but it holds commits its origin does not have",
    ]);
    expect(existsSync(dir)).toBe(true);
  });

  it("safely skips normal untracked directories, ignored directories, and standalone repos", () => {
    const { behind, before, after, dir, lib } = strayFixture();
    move(behind, after);

    mkdirSync(join(behind, "untracked-dir"));
    writeFileSync(join(behind, "untracked-dir", "data.txt"), "data\n");

    mkdirSync(join(behind, "ignored-dir"));
    writeFileSync(join(behind, "ignored-dir", "temp.txt"), "temp\n");
    writeFileSync(join(behind, ".gitignore"), "ignored-dir/\n");

    sh(behind, "clone", "-q", lib.bare, "standalone-repo");

    const lines = followPins(behind, before, after);
    expect(lines).toEqual([
      "stray: removed: its gitlink is gone, and its checkout was clean with every commit on its origin",
    ]);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(behind, "untracked-dir", "data.txt"))).toBe(true);
    expect(existsSync(join(behind, "ignored-dir", "temp.txt"))).toBe(true);
    expect(existsSync(join(behind, "standalone-repo", ".git"))).toBe(true);
  });

  it("cleans stray checkouts directly with cleanStrayCheckouts", () => {
    const { behind, dir } = strayFixture();
    expect(existsSync(dir)).toBe(true);
    const lines = cleanStrayCheckouts(behind);
    expect(lines).toEqual([
      "stray: removed: its gitlink is gone, and its checkout was clean with every commit on its origin",
    ]);
    expect(existsSync(dir)).toBe(false);
  });

  it("removes clean stray checkouts during mainline sync", () => {
    const origin = remote();
    const lib = remote();
    const seed = clone(origin, "seed-parent");
    commit(seed, "first.txt", "1\n", "first");
    sh(seed, "push", "-q", "origin", "HEAD:main");
    sh(origin.main, "pull", "-q", "--ff-only");

    commit(seed, "second.txt", "2\n", "second");
    sh(seed, "push", "-q", "origin", "HEAD:main");

    sh(origin.main, "submodule", "add", "-q", lib.bare, "stray");
    sh(origin.main, "reset", "-q", "HEAD", "stray");
    rmSync(join(origin.main, ".gitmodules"), { force: true });

    const strayDir = join(origin.main, "stray");
    expect(existsSync(strayDir)).toBe(true);

    const report = recorder();
    const code = syncMainline({
      ctx: detect(origin.main)!,
      sync: {
        installWhenChanged: [],
        keepIdenticalFiles: true,
        refuseWithUnlanded: true,
      },
      followSubmodules: true,
      stateDir: join(origin.base, "state"),
      report,
    });
    expect(code).toBe(0);
    expect(existsSync(strayDir)).toBe(false);
    expect(report.lines.join("\n")).toContain(
      "stray: removed: its gitlink is gone, and its checkout was clean with every commit on its origin",
    );
  });

  it("removes a stray checkout an older sync left when the main checkout is already current", () => {
    const origin = remote();
    const lib = remote();
    sh(origin.main, "submodule", "add", "-q", lib.bare, "stray");
    sh(origin.main, "reset", "-q", "HEAD", "stray");
    rmSync(join(origin.main, ".gitmodules"), { force: true });
    const strayDir = join(origin.main, "stray");

    const report = recorder();
    const code = syncMainline({
      ctx: detect(origin.main)!,
      sync: {
        installWhenChanged: [],
        keepIdenticalFiles: true,
        refuseWithUnlanded: true,
      },
      followSubmodules: true,
      stateDir: join(origin.base, "state"),
      report,
    });
    expect(code).toBe(0);
    expect(report.lines.join("\n")).toContain("already equals");
    expect(existsSync(strayDir)).toBe(false);
  });

  it("removes a stray checkout in a linked worktree that is already current", () => {
    const origin = remote();
    const lib = remote();
    const desk = join(origin.base, "desk");
    sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk, "origin/main");
    sh(desk, "submodule", "add", "-q", lib.bare, "stray");
    sh(desk, "reset", "-q", "HEAD", "stray");
    rmSync(join(desk, ".gitmodules"), { force: true });

    const report = recorder();
    const result = syncWorktree({
      ctx: detect(desk)!,
      followSubmodules: true,
      fetch: true,
      report,
    });
    expect(result).toBe("current");
    expect(report.lines.join("\n")).toContain(
      "stray: removed: its gitlink is gone, and its checkout was clean with every commit on its origin",
    );
    expect(existsSync(join(desk, "stray"))).toBe(false);
  });

  it("leaves a linked worktree's stray checkout alone when submodules are not followed", () => {
    const origin = remote();
    const lib = remote();
    const desk = join(origin.base, "desk");
    sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk, "origin/main");
    sh(desk, "submodule", "add", "-q", lib.bare, "stray");
    sh(desk, "reset", "-q", "HEAD", "stray");
    rmSync(join(desk, ".gitmodules"), { force: true });

    syncWorktree({
      ctx: detect(desk)!,
      followSubmodules: false,
      fetch: true,
      report: recorder(),
    });
    expect(existsSync(join(desk, "stray"))).toBe(true);
  });
});
