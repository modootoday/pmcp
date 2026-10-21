import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext, vi } from "vitest";

import { readConfig } from "../../src/config.js";
import { loadGit } from "../../src/git/setup.js";
import { projectStateDir } from "../../src/sessions/state-dir.js";
import { readSpec } from "../../src/project/spec.js";

const TOML = (stateDir: string) =>
  `[sessions]\nstate_dir = ${JSON.stringify(stateDir)}\n\n[sessions.registry]\n\n[git]\n[git.mainline]\nbranch = "main"\n[git.mainline.gate]\ntree = ".gate/tree"\n`;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });

// A main checkout with two linked desks under .claude/worktrees, each with its own pmcp.toml.
function checkouts(t: TestContext, stateDir: string) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-desks-")));
  t.onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const main = join(base, "main");
  execFileSync("git", ["init", "-q", "-b", "main", main]);
  writeFileSync(join(main, "pmcp.toml"), TOML(stateDir));
  git(main, "add", "pmcp.toml");
  git(
    main,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "init",
  );
  const desks = ["a", "b"].map((name) => {
    const desk = join(main, ".claude/worktrees", name);
    git(main, "worktree", "add", "-q", "--detach", desk);
    return desk;
  });
  return { base, main, roots: [main, ...desks] };
}

function resolvedIn(root: string) {
  const spec = readSpec(readConfig(join(root, "pmcp.toml")));
  const hook = projectStateDir(root, spec.hookBundle?.policy?.stateDir);
  const setup = loadGit(root, undefined, process.env);
  if (setup instanceof Error) throw setup;
  return { hook, git: setup.stateDir, tree: setup.config.gate?.tree };
}

describe("a relative state_dir in linked desks", () => {
  it("resolves to the main checkout for the main checkout and every desk", (t) => {
    const { main, roots } = checkouts(t, ".state/desk-b");
    for (const root of roots) {
      expect(resolvedIn(root)).toEqual({
        hook: join(main, ".state/desk-b"),
        git: join(main, ".state/desk-b"),
        tree: join(main, ".gate/tree"),
      });
    }
  });

  it("keeps ~, $HOME and absolute paths as they are in a desk", (t) => {
    const { base, roots } = checkouts(t, "~/state");
    const home = join(base, "home");
    mkdirSync(home);
    vi.stubEnv("HOME", home);
    t.onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    expect(resolvedIn(roots[1]!).hook).toBe(join(home, "state"));
    writeFileSync(join(roots[2]!, "pmcp.toml"), TOML("$HOME/state"));
    expect(resolvedIn(roots[2]!).git).toBe(join(home, "state"));
    writeFileSync(join(roots[1]!, "pmcp.toml"), TOML("/var/tmp/pmcp-desk"));
    expect(resolvedIn(roots[1]!).hook).toBe("/var/tmp/pmcp-desk");
  });

  it("uses the pmcp.toml directory outside git", (t) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-nogit-")));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "pmcp.toml"),
      '[sessions]\nstate_dir = ".state"\n\n[sessions.registry]\n',
    );
    const spec = readSpec(readConfig(join(dir, "pmcp.toml")));
    expect(projectStateDir(dir, spec.hookBundle?.policy?.stateDir)).toBe(
      join(dir, ".state"),
    );
  });
});
