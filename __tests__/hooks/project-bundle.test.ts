import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../src/config.js";
import { sha256 } from "../../src/hooks/compiled.js";
import { project } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";
import { fixture } from "./helpers.js";

const GUARD =
  'import { readFileSync } from "node:fs";\nconst input = JSON.parse(readFileSync(0, "utf8"));\nprocess.stdout.write(JSON.stringify({ decision: input.command.includes("DENY_FIXTURE") ? "deny" : "allow", reason: "custom fixture" }));\n';
const TOML = [
  '[targets]\ntools = ["claude", "codex"]\n',
  '[sessions]\nstate_dir = ".state"\n',
  '[hooks]\nemergency_off_file = ".agents/pmcp-hooks/OFF"\n',
  "[hooks.guards.shell.heredoc]\n",
  '[hooks.guards.shell.stdin_interpreter]\nmode = "ask"\n',
  '[[hooks.shell]]\nname = "policy"\ncommand = ["node", ".agents/guards/policy.mjs"]\ntargets = ["claude", "codex"]\ntimeout_ms = 2000\n',
].join("\n");

function workspace(t: TestContext, toml = TOML) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-bundle-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agents/guards"), { recursive: true });
  writeFileSync(join(root, ".agents/guards/policy.mjs"), GUARD);
  const config = join(root, "pmcp.toml");
  writeFileSync(config, toml);
  const apply = (check = false) => {
    const result = project(readSpec(readConfig(config)), { check });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    return result;
  };
  const json = (file: string) =>
    JSON.parse(readFileSync(join(root, file), "utf8"));
  return { root, config, apply, json };
}

function invoke(
  root: string,
  runtime: "claude" | "codex",
  shellCommand: string,
): any {
  const settings =
    runtime === "claude" ? ".claude/settings.json" : ".codex/hooks.json";
  const entry = JSON.parse(readFileSync(join(root, settings), "utf8")).hooks
    .PreToolUse[0];
  const payload = {
    ...fixture(runtime, "PreToolUse.Bash"),
    cwd: join(root, "nested"),
    tool_input: { command: shellCommand },
  };
  mkdirSync(join(root, "nested"), { recursive: true });
  const out = execFileSync("sh", ["-c", entry.hooks[0].command], {
    cwd: join(root, "nested"),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
}

const verdict = (out: any) => out?.hookSpecificOutput?.permissionDecision;

describe("hook bundle projection", () => {
  it("projects policy.json, hook.mjs and one fixed command per event for both runtimes", (t) => {
    const { root, apply, json } = workspace(t);
    expect(apply().code).toBe(0);
    const policy = readFileSync(
      join(root, ".agents/pmcp-hooks/policy.json"),
      "utf8",
    );
    const lock = json("pmcp.lock").outputs.find(
      (entry: any) => entry.path === ".agents/pmcp-hooks/policy.json",
    );
    expect(lock.sha256).toBe(sha256(policy));
    expect(existsSync(join(root, ".agents/pmcp-hooks/hook.mjs"))).toBe(true);
    const claude = json(".claude/settings.json").hooks.PreToolUse;
    expect(claude).toHaveLength(1);
    expect(claude[0].hooks[0].command).toBe(
      'node "$CLAUDE_PROJECT_DIR/.agents/pmcp-hooks/hook.mjs" claude before_tool',
    );
    expect(claude[0].matcher).toContain("Bash");
    expect(
      json(".codex/hooks.json").hooks.PreToolUse[0].hooks[0].command,
    ).toMatch(
      /exec node \.agents\/pmcp-hooks\/hook\.mjs codex before_tool; fi;/u,
    );
    expect(apply(true).code).toBe(0);
  });

  it("keeps the native command line when only a policy changes", (t) => {
    const { root, config, apply, json } = workspace(t);
    apply();
    const before = json(".codex/hooks.json");
    writeFileSync(config, TOML.replace('mode = "ask"', 'mode = "warn"'));
    apply();
    expect(json(".codex/hooks.json")).toEqual(before);
    expect(
      readFileSync(join(root, ".agents/pmcp-hooks/policy.json"), "utf8"),
    ).toContain('"warn"');
  });

  it.for(["claude", "codex"] as const)(
    "runs the projected hook for %s from a nested directory",
    (runtime, t) => {
      const { root, apply } = workspace(t);
      apply();
      expect(verdict(invoke(root, runtime, "cat <<EOF > f\nx\nEOF"))).toBe(
        "deny",
      );
      expect(verdict(invoke(root, runtime, "echo DENY_FIXTURE"))).toBe("deny");
      expect(verdict(invoke(root, runtime, "cat gen.py | python3"))).toBe(
        runtime === "claude" ? "ask" : "deny",
      );
      expect(invoke(root, runtime, "ls -la")).toBeNull();
    },
  );

  it("refuses every shell call when policy.json no longer matches pmcp.lock", (t) => {
    const { root, apply } = workspace(t);
    apply();
    const file = join(root, ".agents/pmcp-hooks/policy.json");
    writeFileSync(file, readFileSync(file, "utf8").replace('"ask"', '"off"'));
    const out = invoke(root, "claude", "ls");
    expect(verdict(out)).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(
      /pmcp\.lock/u,
    );
  });

  it("lets guards pass while the emergency off file exists and refuses agent writes to it", (t) => {
    const { root, apply } = workspace(t);
    apply();
    writeFileSync(join(root, ".agents/pmcp-hooks/OFF"), "");
    expect(invoke(root, "codex", "cat <<EOF > f\nx\nEOF")).toBeNull();
    expect(verdict(invoke(root, "codex", "rm ../.agents/pmcp-hooks/OFF"))).toBe(
      "deny",
    );
    expect(
      verdict(invoke(root, "claude", "touch .agents/pmcp-hooks/OFF")),
    ).toBe("deny");
  });

  it("writes one JSONL line per call under the configured state dir", (t) => {
    const { root, apply } = workspace(t);
    apply();
    invoke(root, "claude", "cat <<EOF > f\nx\nEOF");
    const dir = join(root, ".state/logs");
    const [file] = readdirSync(dir);
    const line = JSON.parse(
      readFileSync(join(dir, file!), "utf8").trim().split("\n").at(-1)!,
    );
    expect(Object.keys(line)).toEqual([
      "ts",
      "level",
      "component",
      "trace",
      "runtime",
      "event",
      "session",
      "verdict",
      "duration_ms",
      "msg",
      "data",
    ]);
    expect(line).toMatchObject({
      level: "info",
      runtime: "claude",
      event: "before_tool",
      verdict: "deny",
      msg: "hook",
    });
  });

  it("removes owned entries and keeps peer entries when [hooks] goes away", (t) => {
    const { root, config, apply, json } = workspace(t);
    const peer = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "peer-guard" }],
    };
    mkdirSync(join(root, ".claude"));
    writeFileSync(
      join(root, ".claude/settings.json"),
      JSON.stringify({ hooks: { PreToolUse: [peer] }, model: "x" }),
    );
    apply();
    expect(json(".claude/settings.json").hooks.PreToolUse).toHaveLength(2);
    writeFileSync(config, '[targets]\ntools = ["claude", "codex"]\n');
    expect(apply().code).toBe(0);
    expect(json(".claude/settings.json")).toEqual({
      hooks: { PreToolUse: [peer] },
      model: "x",
    });
    expect(existsSync(join(root, ".agents/pmcp-hooks/policy.json"))).toBe(
      false,
    );
  });

  it.for([
    ["an unknown guard", "[hooks.guards.shell.nope]\n"],
    ["an unknown group", "[hooks.guards.net.x]\n"],
    ["an unknown option", "[hooks.guards.shell.heredoc]\nfoo = 1\n"],
    ["a bad mode", '[hooks.guards.shell.heredoc]\nmode = "maybe"\n'],
    [
      "graded on a guard that does not grade",
      '[hooks.guards.shell.heredoc]\nmode = "graded"\n',
    ],
    [
      "ask refused where codex has no ask",
      '[hooks]\nask_fallback = "refuse"\n[hooks.guards.shell.stdin_interpreter]\nmode = "ask"\n',
    ],
    [
      "an error log outside the project",
      '[hooks]\nerror_log = "../hook.jsonl"\n',
    ],
  ] as const)("rejects %s before projecting", ([, source], t) => {
    const { root, config } = workspace(
      t,
      `[targets]\ntools = ["claude", "codex"]\n${source}`,
    );
    expect(() => readSpec(readConfig(config))).toThrow(/\[hooks[.\]]/u);
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(false);
  });
});
