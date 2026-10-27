import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";
import {
  firstWords,
  unmanagedHookProblems,
} from "../src/project/unmanaged-hooks.js";

function file(root: string, path: string, text: string, mode = 0o644): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  chmodSync(join(root, path), mode);
}

const hooks = (event: string, commands: readonly string[]) =>
  JSON.stringify({
    hooks: {
      [event]: [
        {
          matcher: "Bash",
          hooks: commands.map((command) => ({ type: "command", command })),
        },
      ],
    },
  });

function project(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-unmanaged-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  file(root, "pmcp.toml", "[targets]\ntools = []\n");
  file(root, "tools/ok.sh", "#!/bin/sh\nexit 0\n", 0o755);
  file(root, "tools/noexec.sh", "#!/bin/sh\nexit 0\n", 0o644);
  file(root, "tools/noshebang.sh", "exit 0\n", 0o755);
  file(root, "tools/guard.mjs", "process.exit(0)\n");
  return root;
}

async function cli(root: string, ...args: string[]) {
  let out = "";
  const ui = new Ui({
    stdout: { write: (text) => void (out += text) },
    stderr: { write: (text) => void (out += text) },
  });
  const code = await dispatch(args, { cwd: root, env: { HOME: root }, ui });
  return { code, out };
}

describe("native hook entries pmcp does not own", () => {
  it("must name an existing script, executable with a shebang when run directly", (t) => {
    const root = project(t);
    file(
      root,
      ".claude/settings.json",
      hooks("PreToolUse", [
        'node "$CLAUDE_PROJECT_DIR/.agents/pmcp-hooks/hook.mjs" claude before_tool',
        '"$CLAUDE_PROJECT_DIR"/tools/ok.sh',
        "tools/missing.sh --flag",
        "$CLAUDE_PROJECT_DIR/tools/noexec.sh",
        "LANG=C tools/noshebang.sh",
        "node tools/guard.mjs",
        "node tools/gone.mjs",
        "node -e 'process.exit(0)'",
        "peer-guard --flag",
        "${CLAUDE_PLUGIN_ROOT}/x.sh",
      ]),
    );
    file(root, ".codex/hooks.json", hooks("Stop", ["./tools/gone.sh && true"]));
    expect(
      unmanagedHookProblems(root, {}).map((p) => [
        p.file,
        p.command,
        p.problem,
      ]),
    ).toEqual([
      [
        ".claude/settings.json",
        "tools/missing.sh --flag",
        "the script does not exist",
      ],
      [
        ".claude/settings.json",
        "$CLAUDE_PROJECT_DIR/tools/noexec.sh",
        "the script is not executable",
      ],
      [
        ".claude/settings.json",
        "LANG=C tools/noshebang.sh",
        "the script has no shebang",
      ],
      [
        ".claude/settings.json",
        "node tools/gone.mjs",
        "the script does not exist",
      ],
      [
        ".claude/settings.json",
        "${CLAUDE_PLUGIN_ROOT}/x.sh",
        "${CLAUDE_PLUGIN_ROOT} outside a plugin",
      ],
      [
        ".codex/hooks.json",
        "./tools/gone.sh && true",
        "the script does not exist",
      ],
    ]);
  });

  it("checks the hooks of plugins kept in the repository against their own root", (t) => {
    const root = project(t);
    execFileSync("git", ["init", "-q"], { cwd: root });
    file(root, "plugins/kit/.claude-plugin/plugin.json", '{"name":"kit"}');
    file(root, "plugins/kit/hooks/run.sh", "#!/bin/sh\n", 0o755);
    file(
      root,
      "plugins/kit/hooks/hooks.json",
      hooks("PostToolUse", [
        "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh",
        "${CLAUDE_PLUGIN_ROOT}/hooks/gone.sh",
      ]),
    );
    execFileSync("git", ["add", "plugins"], { cwd: root });
    expect(unmanagedHookProblems(root, {})).toEqual([
      {
        file: "plugins/kit/hooks/hooks.json",
        event: "PostToolUse",
        command: "${CLAUDE_PLUGIN_ROOT}/hooks/gone.sh",
        problem: "the script does not exist",
      },
    ]);
  });

  it("fails project --check and doctor, and passes once fixed", async (t) => {
    const root = project(t);
    file(
      root,
      ".claude/settings.json",
      hooks("PreToolUse", ["tools/missing.sh"]),
    );
    const checked = await cli(root, "project", "--check");
    expect(checked.code).toBe(2);
    expect(checked.out).toContain(
      "native hook entry pmcp does not own: .claude/settings.json PreToolUse: tools/missing.sh: the script does not exist",
    );
    const doctor = await cli(root, "doctor", "--json");
    expect(doctor.code).toBe(1);
    expect(JSON.parse(doctor.out).findings).toContainEqual(
      expect.objectContaining({
        check: "native hooks pmcp does not own",
        status: "fail",
      }),
    );
    file(root, "tools/missing.sh", "#!/bin/sh\n", 0o755);
    expect((await cli(root, "project", "--check")).code).toBe(0);
  });

  it("reads the first simple command's words", () => {
    expect(firstWords(`a "b c" 'd'e && f`)).toEqual(["a", "b c", "de"]);
    expect(firstWords("x;y")).toEqual(["x"]);
  });
});
