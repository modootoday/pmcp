import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import { readWorktreeSync } from "../../../../src/hooks/compile/worktree-sync.js";
import type { WorktreeSyncOptions } from "../../../../src/hooks/policies/workspace/worktree-sync.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  scratchStore,
} from "../../helpers.js";

const OPTIONS: WorktreeSyncOptions = {
  root: ".claude/worktrees",
  onSessionStart: "fetch_and_move",
  betweenPrompts: "move_if_light",
  installAfterMove: "off",
  installWhen: ["bun.lock"],
  noticePaths: ["AGENTS.md"],
  followSubmodules: false,
};
const policy = compiled([
  guard(
    "git.worktrees.sync",
    "warn",
    OPTIONS as unknown as Record<string, unknown>,
  ),
]);

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
    {
      cwd,
      encoding: "utf8",
    },
  ).trim();
}

function workspace(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-desk-sync-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, main], { stdio: "ignore" });
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "push", "-q", "origin", "HEAD:main");
  const desk = join(main, ".claude/worktrees/kit");
  git(main, "worktree", "add", "-q", "-b", "worktree-kit", desk, "origin/main");
  const advance = (file: string) => {
    writeFileSync(join(main, file), `${file}\n`);
    git(main, "add", file);
    git(main, "commit", "-q", "-m", file);
    git(main, "push", "-q", "origin", "HEAD:main");
  };
  return { main, desk, advance };
}

function event(name: "SessionStart" | "UserPromptSubmit", cwd: string) {
  const payload: Record<string, any> = { ...fixture("claude", name), cwd };
  return RUNTIMES.claude.normalize(name, payload, cwd)!;
}

describe("git.worktrees.sync", () => {
  it("moves a clean desk onto the mainline at session start and names changed rule files", async (t) => {
    const { desk, advance } = workspace(t);
    advance("AGENTS.md");
    const out = await decide(event("SessionStart", desk), policy, {
      store: scratchStore(),
    });
    expect(out.context?.join("\n")).toMatch(
      /re-read them before going on: AGENTS\.md/u,
    );
    expect(git(desk, "log", "-1", "--format=%s")).toBe("AGENTS.md");
  });

  it("leaves a desk with uncommitted work where it is and says why", async (t) => {
    const { desk, advance } = workspace(t);
    advance("a.txt");
    writeFileSync(join(desk, "mine.txt"), "x\n");
    git(desk, "add", "mine.txt");
    const out = await decide(event("SessionStart", desk), policy, {
      store: scratchStore(),
    });
    expect(out.context?.join("\n")).toMatch(
      /uncommitted changes; left where it is/u,
    );
    expect(git(desk, "log", "-1", "--format=%s")).toBe("init");
  });

  it("does not move a desk between prompts when the move would need an install", async (t) => {
    const { desk, advance } = workspace(t);
    advance("bun.lock");
    git(desk, "fetch", "-q", "origin");
    const out = await decide(event("UserPromptSubmit", desk), policy, {
      store: scratchStore(),
    });
    expect(out.context?.[0]).toMatch(/changed bun\.lock/u);
    expect(git(desk, "log", "-1", "--format=%s")).toBe("init");
  });

  it("holds a worktree while any configured lease is held, whatever its name", async (t) => {
    const { desk, advance } = workspace(t);
    advance("c.txt");
    const store = scratchStore();
    store.leases.take("deps", { subject: "update the parser" });
    const held = compiled([
      guard("git.worktrees.sync", "warn", {
        ...OPTIONS,
        leases: ["lockfile", "deps"],
      } as unknown as Record<string, unknown>),
    ]);
    const out = await decide(event("SessionStart", desk), held, { store });
    expect(out.context?.[0]).toMatch(
      /was not moved: a change under lease deps is being delivered \(update the parser\)/u,
    );
    expect(git(desk, "log", "-1", "--format=%s")).toBe("init");
  });

  it("compiles every declared lease name into the options, or the implicit lockfile lease", () => {
    const declared = readWorktreeSync(
      {
        git: { worktrees: { sync: {} } },
        sessions: {
          leases: {
            deps: { path: "package-lock.json", blocks: [["npm", "install"]] },
            schema: { path: "schema.sql", blocks: [["migrate"]] },
          },
        },
      },
      "/repo",
    );
    expect(declared?.options["leases"]).toEqual(["deps", "schema"]);
    const implicit = readWorktreeSync(
      {
        git: {
          worktrees: { sync: {} },
          mainline: { sync: { install_when_changed: ["package-lock.json"] } },
        },
      },
      "/repo",
    );
    expect(implicit?.options["leases"]).toEqual(["lockfile"]);
  });

  it("never moves the main checkout, and holds every desk during a pause", async (t) => {
    const { main, desk, advance } = workspace(t);
    advance("b.txt");
    expect(
      (
        await decide(event("SessionStart", main), policy, {
          store: scratchStore(),
        })
      ).context,
    ).toBeUndefined();
    const store = scratchStore();
    store.pause.write({ by: "operator", reason: "incident" });
    const out = await decide(event("SessionStart", desk), policy, { store });
    expect(out.context?.[0]).toMatch(
      /^Worktree .+ was not moved: the workspace is paused/u,
    );
  });
});
