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
  using = policy,
) {
  const payload: Record<string, any> = {
    ...fixture(runtime, "PreToolUse.Bash"),
    cwd,
    tool_input: { command },
  };
  return decide(
    RUNTIMES[runtime].normalize("PreToolUse", payload, project)!,
    using,
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

    it("refuses every form that moves the mainline", async (t) => {
      const { main, desk } = repos(t);
      for (const command of [
        "git push",
        "git push origin",
        "git push origin main",
        "git push origin +HEAD:refs/heads/main",
        "git push --force origin worktree-kit:main",
        "git push origin :main",
        "git push --all origin",
        "git push --mirror",
        "git push origin 'refs/heads/*:refs/heads/*'",
        "git push --repo=origin",
        "git push https://example.invalid/x.git HEAD:main",
      ])
        expect(
          (await push(runtime, main, main, command)).verdict,
          command,
        ).toBe("deny");
      expect(
        (await push(runtime, desk, main, "git push origin HEAD:main")).verdict,
      ).toBe("deny");
    });

    it("passes a dry run, another branch, another remote and a tag", async (t) => {
      const { main, desk } = repos(t);
      for (const command of [
        "git push -n origin HEAD:main",
        "git push --dry-run",
        "git push -nv origin main",
        "git push origin feature",
        "git push -u origin HEAD:topic",
        "git push fork main",
        "git push origin v1.0",
      ])
        expect(
          (await push(runtime, main, main, command)).verdict,
          command,
        ).toBeUndefined();
      // A desk on its own branch with no upstream pushes that branch, not the mainline.
      expect(
        (await push(runtime, desk, main, "git push")).verdict,
      ).toBeUndefined();
      expect(
        (await push(runtime, desk, main, "git push origin HEAD")).verdict,
      ).toBeUndefined();
    });

    it("follows the declared remote and mainline names", async (t) => {
      const { main } = repos(t);
      const declared = compiled([
        guard("git.mainline.deliver", "deny", {
          remote: "upstream",
          branch: "trunk",
        }),
      ]);
      const verdict = async (command: string) =>
        (await push(runtime, main, main, command, declared)).verdict;
      expect(await verdict("git push upstream HEAD:trunk")).toBe("deny");
      expect(await verdict("git push upstream HEAD:main")).toBeUndefined();
      expect(await verdict("git push origin trunk")).toBeUndefined();
    });

    it("passes a submodule's push from its own directory", async (t) => {
      const { main, brand } = repos(t);
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
        { cwd: brand },
      );
      execFileSync(
        "git",
        [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          "-q",
          brand,
          "apps/brand",
        ],
        { cwd: main },
      );
      const sub = join(main, "apps/brand");
      expect(
        (await push(runtime, sub, main, "git push origin HEAD:main")).verdict,
      ).toBeUndefined();
      expect(
        (await push(runtime, main, main, "git -C apps/brand push origin main"))
          .verdict,
      ).toBeUndefined();
      expect(
        (await push(runtime, main, main, "git push origin main")).verdict,
      ).toBe("deny");
    });
  },
);
