import { describe, expect, it } from "vitest";

import {
  classify as classifyWith,
  commandsOf,
} from "../../../src/hooks/shell/classify.js";

// A project's own land scripts and bypass variables, as its pmcp.toml would declare them.
const SCRIPTS = [/tools\/release\/(land|sync)\.mjs$/u];
const BYPASS = ["ACME_ALLOW_DIRECT_PUSH", "ACME_GATE_LOCK_HELD"];
const classify = (command: string) => classifyWith(command, BYPASS, SCRIPTS);

const MUTATING = [
  "git commit -m wip",
  "git -C ../ws commit -m wip",
  "git -c core.hooksPath=x push origin HEAD",
  "timeout 60 git push origin HEAD",
  "env FOO=1 git rebase origin/main",
  "cd apps/x && git stash push -m y",
  "git worktree add ../desk origin/main",
  "bun install --frozen-lockfile",
  "bun run git:land abc1234",
  "node tools/release/land.mjs abc1234",
  "npm publish",
  "docker compose up -d",
  "wrangler deploy",
  "bash -c 'git push origin HEAD'",
  'sh -lc "bun install"',
  "eval git reset --hard",
  'echo "$(git commit -m x)"',
  "echo `git push`",
  "{ git push; }",
  "(cd x && git commit -m y)",
  "cat a | xargs git rm",
];

const READ_ONLY = [
  "git commit-graph verify",
  "git log --oneline --grep=push",
  "git status && echo push",
  "grep -rn 'git commit' scripts/",
  "cat .husky/pre-commit # runs before git commit",
  'rg -n "bun install" README.md',
  "ls docker",
  "git diff origin/main -- tools/release/land.mjs",
  "cat tools/release/sync.mjs",
  "echo 'git push origin main'",
  "git show HEAD:package.json",
];

describe("shell classify", () => {
  it.each(MUTATING)("reads %s as mutating however it is wrapped", (command) => {
    expect(classify(command)?.mutating).toBe(true);
  });

  it.each(READ_ONLY)(
    "reads %s as not mutating when it only mentions a step",
    (command) => {
      expect(classify(command)?.mutating).toBe(false);
    },
  );

  it("treats a commit whose message talks about pushing as a commit, not a push", () => {
    const commit = classify(
      'git commit -m "docs: never git push by hand" --only -- README.md',
    );
    expect(commit?.mutating).toBe(true);
    expect(commit?.pushDirs).toEqual([]);
    expect(
      classify("cd ../ws && git -C sub push origin main")?.pushDirs,
    ).toEqual([["../ws", "sub"]]);
  });

  it("lets only installs, lockfile lands and landing scripts touch the lock", () => {
    expect(classify("bun install")?.lockTouching).toBe(true);
    expect(classify("node tools/release/sync.mjs")?.lockTouching).toBe(true);
    expect(
      classify("git commit --only -- tools/release/sync.mjs")?.lockTouching,
    ).toBe(false);
    expect(classify("git diff -- tools/release/land.mjs")?.lockTouching).toBe(
      false,
    );
    expect(classify("git add tools/release/sync.mjs")?.lockTouching).toBe(
      false,
    );
    // The package names no script of its own: without pmcp.toml data nothing matches.
    expect(classifyWith("node tools/release/land.mjs")?.lockTouching).toBe(
      false,
    );
    expect(classify("bun run git:land abc1234")?.lockTouching).toBe(false);
  });

  it("finds gate bypasses where they take effect, not where they are named", () => {
    expect(classify("git commit --no-verify -m x")?.bypass).toBe(true);
    expect(
      classify("ACME_ALLOW_DIRECT_PUSH=1 git push origin HEAD:main")?.bypass,
    ).toBe(true);
    expect(classify("export ACME_GATE_LOCK_HELD=1")?.bypass).toBe(true);
    expect(classify("env ACME_GATE_LOCK_HELD=1 node land.mjs")?.bypass).toBe(
      true,
    );
    expect(classify("grep -n 'ACME_ALLOW_DIRECT_PUSH' AGENTS.md")?.bypass).toBe(
      false,
    );
    expect(classify('git commit -m "explain --no-verify"')?.bypass).toBe(false);
  });

  it("returns null for a command it cannot read so callers fall back to refusing", () => {
    expect(classify("echo 'unclosed")).toBeNull();
    expect(classify('git commit -m "unclosed')).toBeNull();
  });

  it("keeps a bare wrapper as a step with its raw words", () => {
    expect(commandsOf("env")).toEqual([
      { argv: [], raw: ["env"], assigned: [], dir: "" },
    ]);
  });
});

// A parenthesis inside quotes within a substitution is literal (live finding, 2026-10-20).
describe("quoted parentheses inside $( ... ) and backticks", () => {
  const programs = (script: string) =>
    commandsOf(script)?.map((step) => step.argv[0]);
  it.each([
    ['n=$(grep -n "^function a\\|function a(" f | head -1)', ["grep", "head"]],
    ['x=$(echo "a)" | wc -c)', ["echo", "wc"]],
    ["x=$(echo 'a(' 'b)')", ["echo"]],
    ['x=$(echo "$(printf "(")")', ["echo", "printf"]],
    ['echo "$(grep -c "f(" x)"', ["echo", "grep"]],
    ['x=`grep -n "a(" f`', ["grep"]],
    ["x=$(echo a\\) b)", ["echo"]],
  ])("parses %s", (script, expected) => {
    const found = programs(script);
    expect(found).not.toBeNull();
    for (const name of expected) expect(found).toContain(name);
  });
});
