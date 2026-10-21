import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { notes } from "../scripts/release/notes.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// A scratch repository: v1.0.0 published, v1.0.1 tagged but never published, then the
// commits of the release under test, tagged v1.0.2.
function history() {
  const cwd = mkdtempSync(join(tmpdir(), "pmcp-notes-"));
  dirs.push(cwd);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" });
  let n = 0;
  const commit = (message: string) => {
    writeFileSync(join(cwd, "file.txt"), String(n++));
    git("add", "file.txt");
    git("commit", "-q", "-m", message);
  };
  git("init", "-q", "-b", "main");
  commit("feat: before the previous release");
  git("tag", "v1.0.0");
  commit("fix(cli): shipped in the tag that never published");
  git("tag", "v1.0.1");
  commit("feat(sessions): worktree selector");
  commit("docs: a new guide");
  commit("chore: tidy the scripts");
  commit("refactor!: drop the old view operations");
  commit(
    "fix(api): rename a field\n\nBREAKING CHANGE: clients read `id` instead of `key`.",
  );
  commit("Update things");
  git("tag", "v1.0.2");
  return cwd;
}

const run = (cwd: string, summary = false) =>
  notes({
    to: "v1.0.2",
    published: ["v1.0.0"],
    repo: "acme/tool",
    cwd,
    summary,
  });

it("starts after the previous published release, skipping a tag that never published", () => {
  const { from, text } = run(history());
  expect(from).toBe("v1.0.0");
  expect(text).toContain("cli: shipped in the tag that never published");
  expect(text).not.toContain("before the previous release");
  expect(text).toContain(
    "https://github.com/acme/tool/compare/v1.0.0...v1.0.2",
  );
});

it("groups by type in a fixed order, breaking changes first with their footer", () => {
  const { text } = run(history());
  const order = [
    "### Breaking changes",
    "### Features",
    "### Fixes",
    "### Documentation",
    "### Other changes",
  ].map((title) => text.indexOf(title));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const breaking = text.slice(order[0], order[1]);
  expect(breaking).toContain("drop the old view operations");
  expect(breaking).toContain("api: rename a field");
  expect(breaking).toContain("  clients read `id` instead of `key`.");
  expect(text.slice(order[1], order[2])).toContain(
    "sessions: worktree selector",
  );
  expect(text.slice(order[4])).toContain("tidy the scripts");
  expect(text.slice(order[4])).toContain("Update things");
  expect(text).toMatch(
    /\(\[[0-9a-f]{7}\]\(https:\/\/github\.com\/acme\/tool\/commit\/[0-9a-f]{40}\)\)/u,
  );
  expect(text).toContain("[Upgrading](https://pmcp.build/upgrading/)");
});

it("lists non-conventional subjects only in the rehearsal summary", () => {
  const cwd = history();
  expect(run(cwd).text).not.toContain("### Not conventional");
  const summary = run(cwd, true).text;
  expect(summary).toContain("### Not conventional");
  expect(summary.slice(summary.indexOf("### Not conventional"))).toContain(
    "Update things",
  );
});

it("takes the whole history when no release was published before", () => {
  const cwd = history();
  const { from, text } = notes({
    to: "v1.0.2",
    published: [],
    repo: "acme/tool",
    cwd,
  });
  expect(from).toBeUndefined();
  expect(text).toContain("before the previous release");
  expect(text).not.toContain("/compare/");
});
