import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { gitProbe } from "../../../../src/hooks/policies/git-probe.js";
import {
  cases,
  compiled,
  decide,
  fixture,
  guard,
  runShell,
} from "../../helpers.js";
import { RUNTIMES as ADAPTERS } from "../../../../src/hooks/runtimes/index.js";

const RUNTIMES: RuntimeId[] = ["claude", "codex"];

function repoWithWorktree(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-git-guard-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "pipe" });
  execFileSync("git", ["init", "-q", "-b", "main", main]);
  git(
    main,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  git(main, "worktree", "add", "-q", "-b", "feature", join(root, "desk"));
  return { main, desk: join(root, "desk") };
}

async function shellIn(runtime: RuntimeId, cwd: string, command: string) {
  const adapter = ADAPTERS[runtime];
  const payload = {
    ...fixture(runtime, "PreToolUse.Bash"),
    cwd,
    tool_input: { command },
  };
  const input = adapter.normalize("PreToolUse", payload, cwd)!;
  const policy = compiled([guard("git.forced_branch_move")]);
  return decide(input, policy, { git: gitProbe });
}

describe.each(RUNTIMES)("git guards on %s payloads", (runtime) => {
  const push = cases("git", "push-without-verify");
  it.each(push.blocked)(
    "git.push_without_verify denies %s",
    async (command) => {
      expect(
        (
          await runShell(
            runtime,
            compiled([guard("git.push_without_verify")]),
            command,
          )
        ).verdict,
      ).toBe("deny");
    },
  );
  it.each(push.allowed)(
    "git.push_without_verify allows %s",
    async (command) => {
      expect(
        (
          await runShell(
            runtime,
            compiled([guard("git.push_without_verify")]),
            command,
          )
        ).verdict,
      ).toBeUndefined();
    },
  );

  const bypass = cases("git", "gate-bypass-env") as unknown as {
    options: Record<string, unknown>;
    blocked: string[];
    allowed: string[];
  };
  const bypassPolicy = compiled([
    guard("git.gate_bypass_env", "deny", bypass.options),
  ]);
  it.each(bypass.blocked)("git.gate_bypass_env denies %s", async (command) => {
    expect((await runShell(runtime, bypassPolicy, command)).verdict).toBe(
      "deny",
    );
  });
  it.each(bypass.allowed)("git.gate_bypass_env allows %s", async (command) => {
    expect(
      (await runShell(runtime, bypassPolicy, command)).verdict,
    ).toBeUndefined();
  });

  it("git.forced_branch_move denies moving a branch checked out in another worktree", async (t) => {
    const { main } = repoWithWorktree(t);
    expect(
      (await shellIn(runtime, main, "git branch -f feature HEAD")).verdict,
    ).toBe("deny");
    expect(
      (await shellIn(runtime, main, "git branch --force feature HEAD")).verdict,
    ).toBe("deny");
  });

  it("git.forced_branch_move allows a forced move of a branch no other worktree holds", async (t) => {
    const { main, desk } = repoWithWorktree(t);
    expect(
      (await shellIn(runtime, main, "git branch -f spare HEAD")).verdict,
    ).toBeUndefined();
    expect(
      (await shellIn(runtime, desk, "git branch -f feature HEAD")).verdict,
    ).toBeUndefined();
    expect(
      (await shellIn(runtime, main, "git branch feature-2")).verdict,
    ).toBeUndefined();
  });
});
