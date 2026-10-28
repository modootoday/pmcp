import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { readGitConfig } from "../../src/git/config.js";
import { detect } from "../../src/git/detect.js";
import type { DeliverReceipt } from "../../src/git/mainline/deliver.js";
import { checkoutKind } from "../../src/git/worktrees/desk.js";
import type { ProjectConfig } from "../../src/config.js";
import {
  clone,
  commit,
  isolateGit,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

// A pmcp.toml committed on the mainline, as a project keeps it, so every worktree has it.
function project(origin: Remote, extra = ""): string {
  const state = join(origin.base, "state");
  commit(
    origin.main,
    "pmcp.toml",
    `[sessions]\nstate_dir = "${state}"\n[git]\n[git.worktrees]\n${extra}[git.mainline.sync]\n[git.mainline.deliver]\nattempts = 1\n`,
    "pmcp.toml",
  );
  sh(origin.main, "push", "-q", "origin", "HEAD:main");
  return state;
}

function worktree(origin: Remote, path: string): string {
  const dir = join(origin.main, path);
  const branch = `wt-${path.split("/").at(-1)}`;
  sh(origin.main, "worktree", "add", "-q", "-b", branch, dir, "origin/main");
  return dir;
}

function advance(origin: Remote, file: string): string {
  const other = clone(origin, `other-${file}`);
  commit(other, file, "upstream\n", `add ${file}`);
  sh(other, "push", "-q", "origin", "HEAD:main");
  return sh(other, "rev-parse", "HEAD");
}

async function run(cwd: string, ...args: string[]) {
  let out = "";
  const ui = new Ui({
    env: {},
    stdout: { write: (text) => void (out += text) },
    stderr: { write: (text) => void (out += text) },
  });
  const code = await dispatch(["git", ...args], { cwd, ui, env: process.env });
  return { code, out };
}

describe("pmcp git sync in a desk", () => {
  it("moves a clean desk to the mainline", async () => {
    const origin = remote();
    project(origin);
    const desk = worktree(origin, ".claude/worktrees/alpha");
    const tip = advance(origin, "a.txt");
    expect((await run(desk, "sync")).code).toBe(0);
    expect(sh(desk, "rev-parse", "HEAD")).toBe(tip);
  });

  it("holds a desk with uncommitted edits, an unlanded commit, or during a pause (exit 1)", async () => {
    const origin = remote();
    const state = project(origin);
    const desk = worktree(origin, ".claude/worktrees/alpha");
    advance(origin, "a.txt");
    const before = sh(desk, "rev-parse", "HEAD");
    writeFileSync(join(desk, "README.md"), "edited\n");
    const dirty = await run(desk, "sync");
    expect(dirty.code).toBe(1);
    expect(dirty.out).toContain("uncommitted changes");
    sh(desk, "checkout", "--", "README.md");
    mkdirSync(state, { recursive: true });
    writeFileSync(
      join(state, "pause.json"),
      JSON.stringify({ by: "operator", reason: "incident", since: "now" }),
    );
    const paused = await run(desk, "sync");
    expect(paused.code).toBe(1);
    expect(paused.out).toContain("the sessions are paused (incident");
    writeFileSync(join(state, "pause.json"), "null");
    const mine = commit(desk, "mine.txt", "mine\n", "mine");
    const unlanded = await run(desk, "sync");
    expect(unlanded.code).toBe(1);
    expect(unlanded.out).toContain("1 unlanded commit(s)");
    expect(sh(desk, "rev-parse", "HEAD")).toBe(mine);
    expect(sh(desk, "rev-parse", "HEAD^")).toBe(before);
  });

  it("refuses a linked worktree that is not a desk (exit 2) and still syncs the main checkout", async () => {
    const origin = remote();
    project(origin);
    const scratch = worktree(origin, "tmp/scratch");
    const tip = advance(origin, "a.txt");
    const refused = await run(scratch, "sync");
    expect(refused.code).toBe(2);
    expect(refused.out).toContain("not a desk");
    expect((await run(origin.main, "sync")).code).toBe(0);
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(tip);
  });

  it("derives the kind from [git.worktrees] desks", () => {
    const origin = remote();
    const desk = worktree(origin, ".claude/worktrees/alpha");
    const read = (worktrees: Record<string, unknown>) =>
      readGitConfig({
        path: "pmcp.toml",
        dir: origin.main,
        raw: { git: { worktrees } },
      } as unknown as ProjectConfig)!.worktrees!;
    expect(read({}).desks).toBe(".claude/worktrees/*");
    expect(read({ root: "desks" }).desks).toBe("desks/*");
    expect(checkoutKind(detect(origin.main)!, read({}))).toBe("shared");
    expect(checkoutKind(detect(desk)!, read({}))).toBe("desk");
    expect(checkoutKind(detect(desk)!, read({ desks: "desks/*" }))).toBe(
      "scratch",
    );
    expect(checkoutKind(detect(desk)!, undefined)).toBe("scratch");
  });
});

describe("after a delivery from a desk", () => {
  async function deliverFrom(origin: Remote, extra: string) {
    project(origin, extra);
    const desk = worktree(origin, ".claude/worktrees/alpha");
    const before = commit(desk, "work.txt", "work\n", "work");
    // Another session lands first, so the delivered copy is a new commit the desk lacks.
    advance(origin, "b.txt");
    const result = await run(desk, "deliver", "--json");
    const line = result.out
      .split("\n")
      .find((text) => text.startsWith('{"ok"'));
    return {
      desk,
      before,
      code: result.code,
      receipt: JSON.parse(line!) as DeliverReceipt,
    };
  }

  it('syncs the delivering desk with [git.worktrees.sync] after_deliver = "desk"', async () => {
    const origin = remote();
    const { desk, before, code, receipt } = await deliverFrom(
      origin,
      '[git.worktrees.sync]\nafter_deliver = "desk"\n',
    );
    expect(code).toBe(0);
    const delivered = sh(origin.bare, "rev-parse", "main");
    expect(delivered).not.toBe(before);
    expect(receipt.desk_sync).toEqual({ from: before, to: delivered, code: 0 });
    expect(sh(desk, "rev-parse", "HEAD")).toBe(delivered);
    expect(readFileSync(join(desk, "work.txt"), "utf8")).toBe("work\n");
  });

  it("leaves the desk alone by default", async () => {
    const origin = remote();
    const { desk, before, receipt } = await deliverFrom(origin, "");
    expect(receipt.desk_sync).toBeNull();
    expect(sh(desk, "rev-parse", "HEAD")).toBe(before);
  });
});
