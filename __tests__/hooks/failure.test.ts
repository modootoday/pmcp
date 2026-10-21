import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Decision, HookInput } from "../../src/hooks/contract.js";
import {
  readFailure,
  type FailureSettings,
} from "../../src/hooks/dispatch/failure.js";
import {
  runPolicy,
  type RunDeps,
} from "../../src/hooks/dispatch/run-policy.js";
import { silentLogger } from "../../src/logging/logger.js";
import { compiled, fixture, noGit, scratchStore } from "./helpers.js";
import { failedEntry, rawFailure } from "../../src/hooks/entry/fail-closed.js";
import { bindingsFor } from "../../src/hooks/compile/bindings.js";
import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import { POLICY_FILE } from "../../src/hooks/compiled.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// A guard that fails to evaluate is an infrastructure failure, not a verdict: with
// [hooks.failure] it is retried, then a read or an edit in the session's own worktree passes
// with a warning and anything else is refused, each with a one-line cause.

let repo = "";
let desk = "";
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "pmcp-failure-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git("add", "a.txt");
  git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-q",
    "-m",
    "a",
  );
  desk = join(repo, "..", `${repo.split("/").pop()}-desk`);
  git("worktree", "add", "-q", desk);
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(desk, { recursive: true, force: true });
});

function input(
  kind: "read" | "edit" | "shell",
  cwd: string,
  paths: string[] = [],
): HookInput {
  return {
    contract: 2,
    runtime: "claude",
    event: "before_tool",
    session: { id: "s" },
    cwd,
    projectRoot: repo,
    tool: {
      kind,
      native: kind,
      paths,
      ...(kind === "shell" ? { command: "rm -rf x" } : {}),
    },
  } as unknown as HookInput;
}

function policy(
  evaluate: () => Decision | Promise<Decision>,
  fail: "open" | "closed" = "closed",
) {
  return {
    policy: { id: "test.guard", fail, options: () => ({}), evaluate } as never,
    mode: "deny" as const,
    options: {},
  };
}

const deps = (failure?: FailureSettings): RunDeps => ({
  log: silentLogger,
  git: noGit,
  store: scratchStore(),
  now: () => 0,
  ...(failure ? { failure } : {}),
});

const failure = readFailure({
  timeout_ms: 100,
  retry: 1,
  pass: ["read", "edit-own-worktree"],
})!;
const broken = () => {
  throw new Error("state file unreadable\nstack line");
};

describe("[hooks.failure]", () => {
  it("reads its keys and refuses unknown ones and kinds", () => {
    expect(readFailure({})).toEqual({ timeoutMs: 2000, retry: 1, pass: [] });
    expect(failure).toEqual({
      timeoutMs: 100,
      retry: 1,
      pass: ["read", "edit-own-worktree"],
    });
    expect(() => readFailure({ pass: ["bash"] })).toThrow("pass must list");
    expect(() => readFailure({ timeout_ms: 5 })).toThrow(
      "timeout_ms must be an integer",
    );
    expect(() => readFailure({ block: [] })).toThrow("unknown key block");
  });

  it("changes nothing without the table: a failed guard refuses", async () => {
    const decision = await runPolicy(
      policy(broken),
      input("read", desk),
      deps(),
    );
    expect(decision).toEqual({
      verdict: "deny",
      reason: "pmcp test.guard failed, refusing to be safe",
    });
  });

  it("passes a read with a warning and refuses a shell call, naming the cause", async () => {
    const read = await runPolicy(
      policy(broken),
      input("read", desk),
      deps(failure),
    );
    expect(read).toEqual({
      context: [
        "pmcp hooks: test.guard failed (error: state file unreadable); passed with a warning",
      ],
    });
    const shell = await runPolicy(
      policy(broken),
      input("shell", desk),
      deps(failure),
    );
    expect(shell).toEqual({
      verdict: "deny",
      reason:
        "pmcp hooks: test.guard failed (error: state file unreadable); refused",
    });
  });

  it("passes an edit inside the session's linked worktree, never in the shared main checkout", async () => {
    const own = await runPolicy(
      policy(broken),
      input("edit", desk, ["a.txt"]),
      deps(failure),
    );
    expect(own.context?.[0]).toContain("passed with a warning");
    const main = await runPolicy(
      policy(broken),
      input("edit", repo, ["a.txt"]),
      deps(failure),
    );
    expect(main.verdict).toBe("deny");
    const outside = await runPolicy(
      policy(broken),
      input("edit", desk, ["../elsewhere.txt"]),
      deps(failure),
    );
    expect(outside.verdict).toBe("deny");
  });

  it("bounds each try by timeout_ms", async () => {
    const hangs = () => new Promise<Decision>(() => {});
    const decision = await runPolicy(
      policy(hangs),
      input("shell", desk),
      deps(failure),
    );
    expect(decision.reason).toBe(
      "pmcp hooks: test.guard failed (timeout 100 ms); refused",
    );
  });

  it("uses a successful retry, and never touches a guard's own deny", async () => {
    let calls = 0;
    const flaky = () => {
      calls += 1;
      if (calls === 1) throw new Error("busy");
      return { verdict: "deny" as const, reason: "heredocs are refused" };
    };
    const decision = await runPolicy(
      policy(flaky),
      input("read", desk),
      deps(failure),
    );
    expect(calls).toBe(2);
    expect(decision).toMatchObject({
      verdict: "deny",
      reason: "heredocs are refused",
    });
  });

  it("keeps a fail-open guard open", async () => {
    expect(
      await runPolicy(
        policy(broken, "open"),
        input("shell", desk),
        deps(failure),
      ),
    ).toEqual({});
  });
});

// The incident behind [hooks.failure] was the whole hook failing, not one guard.
describe("[hooks.failure] when the hook entry itself fails", () => {
  const claude = RUNTIMES.claude;
  const call = (name: string) => {
    const payload = fixture("claude", name);
    return claude.normalize("PreToolUse", payload, payload["cwd"])!;
  };
  const crash = new Error("store unreadable\nat x");

  it("passes a read with the warning and refuses a shell call, judged from the call alone", () => {
    const read = JSON.parse(
      failedEntry(
        claude,
        "before_tool",
        repo,
        call("PreToolUse.Read"),
        failure,
        crash,
      ),
    );
    expect(JSON.stringify(read)).toContain(
      "pmcp hooks: the hook failed (error: store unreadable); passed with a warning",
    );
    expect(JSON.stringify(read)).not.toContain("deny");
    const bash = JSON.parse(
      failedEntry(
        claude,
        "before_tool",
        repo,
        call("PreToolUse.Bash"),
        failure,
        crash,
      ),
    );
    expect(JSON.stringify(bash)).toContain("deny");
    expect(JSON.stringify(bash)).toContain(
      "pmcp hooks: the hook failed (error: store unreadable); refused",
    );
    expect(
      JSON.stringify(
        JSON.parse(
          failedEntry(claude, "before_tool", repo, null, failure, crash),
        ),
      ),
    ).toContain("refused");
  });

  it("reads the table from policy.json without compiling it", () => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-raw-failure-"));
    mkdirSync(dirname(join(root, POLICY_FILE)), { recursive: true });
    writeFileSync(
      join(root, POLICY_FILE),
      JSON.stringify({ failure: { timeoutMs: 100, retry: 1, pass: ["read"] } }),
    );
    expect(rawFailure(root)).toEqual({
      timeoutMs: 100,
      retry: 1,
      pass: ["read"],
    });
    writeFileSync(
      join(root, POLICY_FILE),
      JSON.stringify({ failure: { timeoutMs: 100, retry: 1, pass: ["bash"] } }),
    );
    expect(rawFailure(root)).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("projects a runtime timeout that outlasts every try plus startup", () => {
    const policy = compiled(
      [{ id: "shell.heredoc", mode: "deny", options: {} }],
      {
        failure: { timeoutMs: 10_000, retry: 1, pass: [] },
      },
    );
    const timeouts = bindingsFor(policy, "claude").map(
      (binding) => binding.timeoutSec,
    );
    expect(Math.min(...timeouts)).toBeGreaterThanOrEqual(23);
  });
});
