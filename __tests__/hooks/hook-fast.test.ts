import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../src/config.js";
import { project } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";
import { fixture } from "./helpers.js";

const TOML = [
  '[targets]\ntools = ["claude"]\n',
  '[sessions]\nstate_dir = ".state"\n',
  "[sessions.registry]\n",
  "[hooks.guards.shell.heredoc]\n",
].join("\n");
const HEREDOC = "cat <<EOF > notes.txt\nhello\nEOF";

// The projected loader and body from the built dist, run as Claude Code runs them.
function projected(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-hookfast-"));
  const cache = mkdtempSync(join(tmpdir(), "pmcp-hookfast-cache-"));
  t.onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });
  writeFileSync(join(root, "pmcp.toml"), TOML);
  const result = project(readSpec(readConfig(join(root, "pmcp.toml"))), {
    check: false,
  });
  if (result.backup)
    t.onTestFinished(() =>
      rmSync(result.backup!, { recursive: true, force: true }),
    );
  const run = (command: string, env: Record<string, string> = {}) => {
    const payload = {
      ...fixture("claude", "PreToolUse.Bash"),
      cwd: root,
      tool_input: { command },
    };
    return spawnSync(
      process.execPath,
      [join(root, ".agents/pmcp-hooks/hook.mjs"), "claude", "before_tool"],
      {
        cwd: root,
        env: { ...process.env, XDG_CACHE_HOME: cache, ...env },
        input: JSON.stringify(payload),
        encoding: "utf8",
      },
    );
  };
  return { root, cache, run };
}

const decision = (stdout: string) =>
  stdout.trim()
    ? JSON.parse(stdout).hookSpecificOutput?.permissionDecision
    : "allow";

describe("the projected hook loader", () => {
  it("projects a loader and a body, and the body imports no heavy builtins", (t) => {
    const { root } = projected(t);
    const loader = readFileSync(
      join(root, ".agents/pmcp-hooks/hook.mjs"),
      "utf8",
    );
    const body = readFileSync(
      join(root, ".agents/pmcp-hooks/hook-body.mjs"),
      "utf8",
    );
    expect(loader.length).toBeLessThan(4000);
    expect(loader).toContain("enableCompileCache");
    expect(body).not.toMatch(/from "node:(fs|crypto|child_process|url)"/u);
  });

  it("gives identical verdicts with the compile cache on and off", (t) => {
    const { run, cache } = projected(t);
    for (const command of ["ls -la", HEREDOC]) {
      const off = run(command, { PMCP_HOOK_COMPILE_CACHE: "off" });
      const cold = run(command);
      const warm = run(command);
      expect(off.status).toBe(0);
      expect(decision(cold.stdout)).toBe(decision(off.stdout));
      expect(warm.stdout).toBe(cold.stdout);
    }
    expect(decision(run(HEREDOC).stdout)).toBe("deny");
    expect(existsSync(join(cache, "pmcp/hook-compile"))).toBe(true);
  });

  it("behaves the same when the cache directory cannot be written", (t) => {
    const { run, cache } = projected(t);
    const blocked = join(cache, "file");
    writeFileSync(blocked, "");
    const result = run(HEREDOC, { XDG_CACHE_HOME: blocked });
    expect(result.status).toBe(0);
    expect(decision(result.stdout)).toBe("deny");
  });

  it("fails open when the body cannot load", (t) => {
    const { root, run } = projected(t);
    rmSync(join(root, ".agents/pmcp-hooks/hook-body.mjs"));
    const result = run(HEREDOC);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/pmcp hook body did not load/u);
  });

  it("never reuses a cached integrity verdict for an edited policy", (t) => {
    const { root, run, cache } = projected(t);
    expect(decision(run(HEREDOC).stdout)).toBe("deny");
    expect(existsSync(join(cache, "pmcp/hook-verified.json"))).toBe(true);
    const policy = join(root, ".agents/pmcp-hooks/policy.json");
    const text = readFileSync(policy, "utf8");
    // Same size is not required: mtime is set back too, and only ctime still tells.
    const before = new Date(Date.now() - 60_000);
    writeFileSync(policy, `${text} `);
    utimesSync(policy, before, before);
    const out = JSON.parse(run("ls -la").stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(
      /policy.json does not match pmcp.lock/u,
    );
  });
});
