import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { climbCommand } from "../../../src/hooks/runtimes/climb.js";
import { RUNTIMES } from "../../../src/hooks/runtimes/index.js";

function scratch(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-climb-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pmcp.toml"), "");
  mkdirSync(join(root, "a/b"), { recursive: true });
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-none-")));
  t.onTestFinished(() => rmSync(outside, { recursive: true, force: true }));
  return { root, outside };
}

const sh = (command: string, cwd: string, env: Record<string, string> = {}) =>
  spawnSync("sh", ["-c", command], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

describe("projected hooks find the project from their real directory", () => {
  it("ignores a stale inherited PWD", (t) => {
    const { root, outside } = scratch(t);
    const run = sh(climbCommand("pwd -P"), join(root, "a/b"), {
      PWD: outside,
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(root);
  });

  it("says so on stderr outside a project and keeps the runtime's silent answer", (t) => {
    const { outside } = scratch(t);
    const allow = `printf '%s\\n' '{"decision":"allow"}'`;
    const run = sh(climbCommand("pwd -P", allow), outside);
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(
      /pmcp: no pmcp\.toml at or above .*; hook skipped/u,
    );
    expect(JSON.parse(run.stdout)).toEqual({ decision: "allow" });
  });

  it("starts from a directory the runtime names, as grok does", (t) => {
    const { root, outside } = scratch(t);
    const command = climbCommand(
      "pwd -P",
      undefined,
      '"${GROK_WORKSPACE_ROOT:-.}"',
    );
    const run = sh(command, outside, { GROK_WORKSPACE_ROOT: join(root, "a") });
    expect(run.stdout.trim()).toBe(root);
  });

  it("gives Gemini a command with no $NAME, so its trusted identity cannot change", () => {
    const plan = {
      bindings: [
        { event: "before_tool" as const, native: "BeforeTool", timeoutSec: 10 },
      ],
    };
    const command = JSON.stringify(RUNTIMES.gemini.project(plan));
    expect(command).not.toMatch(/\$[A-Za-z_{]/u);
    for (const id of ["codex", "antigravity", "grok", "gemini"] as const) {
      const entries = JSON.stringify(
        RUNTIMES[id].project({
          bindings: plan.bindings.map((b) => ({
            ...b,
            native: RUNTIMES[id].nativeEvent("before_tool")!,
          })),
        }),
      );
      expect(entries).not.toMatch(/\$PWD/u);
    }
  });
});
