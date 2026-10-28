import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { readConfig } from "../../src/config.js";
import type { RuntimeId } from "../../src/hooks/contract.js";
import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import { project } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";

const TOML = [
  '[targets]\ntools = ["claude", "codex"]\n',
  '[sessions]\nstate_dir = ".state"\n',
  "[hooks.guards.shell.heredoc]\n",
].join("\n");

// A projected workspace whose pmcp.lock a merge left with conflict markers.
function conflicted(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-lock-repair-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pmcp.toml"), TOML);
  const result = project(readSpec(readConfig(join(root, "pmcp.toml"))), {
    check: false,
  });
  if (result.backup)
    t.onTestFinished(() =>
      rmSync(result.backup!, { recursive: true, force: true }),
    );
  const lock = readFileSync(join(root, "pmcp.lock"), "utf8").split("\n");
  lock.splice(
    3,
    0,
    "<<<<<<< HEAD",
    "  ours",
    "=======",
    "  theirs",
    ">>>>>>> topic",
  );
  writeFileSync(join(root, "pmcp.lock"), lock.join("\n"));
  return root;
}

// One before_tool call through the projected hook entry, read back as its verdict.
function call(
  root: string,
  runtime: RuntimeId,
  what: { command: string } | { path: string },
) {
  const adapter = RUNTIMES[runtime];
  const payload = adapter.synthetic({
    cwd: root,
    session: "abcd1234-session",
    event: adapter.nativeEvent("before_tool")!,
    ...("command" in what
      ? { command: what.command, tool: "shell" }
      : { path: what.path, tool: "edit" }),
  });
  const run = spawnSync(
    process.execPath,
    [join(root, ".agents/pmcp-hooks/hook.mjs"), runtime, "before_tool"],
    {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, XDG_STATE_HOME: join(root, ".xdg") },
    },
  );
  return { verdict: adapter.readVerdict(run.stdout), stdout: run.stdout };
}

describe("a pmcp.lock a merge left unreadable", () => {
  it("lets every runtime repair it and refuses the rest with the way out", (t) => {
    const root = conflicted(t);
    for (const runtime of ["claude", "codex"] as const) {
      const other = call(root, runtime, { command: "ls" });
      expect(other.verdict).toBe("deny");
      expect(other.stdout).toContain(
        "pmcp.lock holds git conflict markers (line 4)",
      );
      expect(other.stdout).toContain("git show <rev>:pmcp.lock > pmcp.lock");
      for (const command of [
        "git show HEAD:pmcp.lock > pmcp.lock",
        "git checkout --theirs -- pmcp.lock",
        "git restore --source=HEAD~1 pmcp.lock",
      ])
        expect(call(root, runtime, { command }).verdict).toBe("allow");
      expect(
        call(root, runtime, { command: "git show HEAD:pmcp.lock > other.txt" })
          .verdict,
      ).toBe("deny");
      expect(
        call(root, runtime, { path: join(root, "pmcp.lock") }).verdict,
      ).toBe("allow");
      expect(
        call(root, runtime, { path: join(root, "other.txt") }).verdict,
      ).toBe("deny");
    }
  });

  it("is named by project --check and doctor instead of crashing them", async (t) => {
    const root = conflicted(t);
    const cli = async (...args: string[]) => {
      let out = "";
      const ui = new Ui({
        stdout: { write: (text) => void (out += text) },
        stderr: { write: (text) => void (out += text) },
      });
      const code = await dispatch(args, {
        cwd: root,
        env: { HOME: root, XDG_STATE_HOME: join(root, ".xdg") },
        ui,
      });
      return { code, out };
    };
    const checked = await cli("project", "--check");
    expect(checked.code).not.toBe(0);
    expect(checked.out).toContain(
      "pmcp.lock holds git conflict markers (line 4)",
    );
    const doctor = await cli("doctor", "--json", "--tool", "claude");
    expect(JSON.parse(doctor.out).findings[0]).toMatchObject({
      check: "outputs match sources",
      status: "fail",
    });
    expect(JSON.parse(doctor.out).findings[0].detail).toContain(
      "conflict markers",
    );
  });
});
