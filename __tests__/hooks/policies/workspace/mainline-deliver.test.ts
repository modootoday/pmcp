import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import { compiled, decide, fixture, guard } from "../../helpers.js";

const policy = compiled([guard("git.mainline.deliver")]);

function repos(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-direct-push-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const brand = join(root, "brand");
  for (const repo of [main, brand])
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync(
    "git",
    [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ],
    { cwd: main },
  );
  const desk = join(main, ".claude/worktrees/kit");
  execFileSync("git", ["worktree", "add", "-q", "-b", "worktree-kit", desk], {
    cwd: main,
  });
  return { main, brand, desk };
}

function push(
  runtime: RuntimeId,
  cwd: string,
  project: string,
  command: string,
) {
  const payload: Record<string, any> = {
    ...fixture(runtime, "PreToolUse.Bash"),
    cwd,
    tool_input: { command },
  };
  return decide(
    RUNTIMES[runtime].normalize("PreToolUse", payload, project)!,
    policy,
  );
}

describe.each(["claude", "codex"] as const)(
  "git.mainline.deliver on %s payloads",
  (runtime) => {
    it("refuses a push from the main checkout or a desk of the project repository", async (t) => {
      const { main, desk } = repos(t);
      expect(
        (await push(runtime, main, main, "git push origin HEAD:main")).verdict,
      ).toBe("deny");
      expect(
        (await push(runtime, desk, main, "bash -c 'git push origin HEAD:main'"))
          .verdict,
      ).toBe("deny");
      expect(
        (await push(runtime, main, main, "echo $(git push)")).verdict,
      ).toBe("deny");
    });

    it("lets another repository push and leaves mentions alone", async (t) => {
      const { main, brand } = repos(t);
      expect(
        (await push(runtime, brand, main, "git push origin HEAD:main")).verdict,
      ).toBeUndefined();
      expect(
        (await push(runtime, main, main, `git -C ${brand} push origin main`))
          .verdict,
      ).toBeUndefined();
      expect(
        (
          await push(
            runtime,
            main,
            main,
            "git commit -m 'never git push by hand'",
          )
        ).verdict,
      ).toBeUndefined();
      expect(
        (await push(runtime, main, main, "pmcp git deliver abc1234")).verdict,
      ).toBeUndefined();
    });
  },
);
