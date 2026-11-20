import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gcWorktrees } from "../src/git/worktrees/gc.js";
import type { GitContext } from "../src/git/types.js";

const dirs: string[] = [];

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("git worktree gc", () => {
  it("protects dirty and unlanded worktrees and removes clean landed desks on apply", () => {
    const base = mkdtempSync(join(tmpdir(), "pmcp-wt-gc-"));
    dirs.push(base);
    const origin = join(base, "origin.git");
    const repo = join(base, "repo");
    run(base, ["init", "--bare", origin]);
    run(base, ["clone", origin, repo]);
    run(repo, ["config", "user.email", "test@example.invalid"]);
    run(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "README.md"), "init\n");
    run(repo, ["add", "README.md"]);
    run(repo, ["commit", "-m", "init"]);
    const branch = run(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    run(repo, ["push", "-u", "origin", branch]);

    const cleanDesk = join(repo, ".desks", "clean-one");
    const dirtyDesk = join(repo, ".desks", "dirty-one");
    const aheadDesk = join(repo, ".desks", "ahead-one");
    run(repo, [
      "worktree",
      "add",
      "-b",
      "wt-clean",
      cleanDesk,
      `origin/${branch}`,
    ]);
    run(repo, [
      "worktree",
      "add",
      "-b",
      "wt-dirty",
      dirtyDesk,
      `origin/${branch}`,
    ]);
    run(repo, [
      "worktree",
      "add",
      "-b",
      "wt-ahead",
      aheadDesk,
      `origin/${branch}`,
    ]);

    writeFileSync(join(dirtyDesk, "uncommitted.txt"), "wip\n");
    writeFileSync(join(aheadDesk, "ahead.txt"), "commit\n");
    run(aheadDesk, ["add", "ahead.txt"]);
    run(aheadDesk, ["commit", "-m", "unlanded"]);

    const ctx: GitContext = {
      root: repo,
      mainRoot: repo,
      gitDir: join(repo, ".git"),
      commonDir: join(repo, ".git"),
      remote: "origin",
      mainline: branch,
      upstream: `origin/${branch}`,
      linked: false,
      projectId: "test-project",
    };
    const config = {
      root: ".desks",
      branchPrefix: "wt-",
      aliasPattern: "^[a-z0-9-]+$",
      linkFromMain: [],
      desks: ".desks/*",
    };

    const preview = gcWorktrees(ctx, config, { apply: false });
    expect(preview.items.find((i) => i.alias === "clean-one")?.action).toBe(
      "would_remove",
    );
    expect(preview.items.find((i) => i.alias === "dirty-one")?.reason).toBe(
      "dirty",
    );
    expect(preview.items.find((i) => i.alias === "ahead-one")?.reason).toBe(
      "unlanded_commits",
    );
    expect(existsSync(cleanDesk)).toBe(true);

    const applied = gcWorktrees(ctx, config, { apply: true });
    expect(applied.items.find((i) => i.alias === "clean-one")?.action).toBe(
      "removed",
    );
    expect(existsSync(cleanDesk)).toBe(false);
    expect(existsSync(dirtyDesk)).toBe(true);
    expect(existsSync(aheadDesk)).toBe(true);
  });
});
