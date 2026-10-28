import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { readConfig } from "../../src/config.js";
import { filesSessionGate } from "../../src/git/mainline/store.js";
import { loadGit } from "../../src/git/setup.js";
import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import { project } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";
import { readStoreSettings } from "../../src/sessions/settings.js";

function temp(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-pause-file-")));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// What another tool pausing the same work writes: the shape pmcp reads and writes.
function foreignPause(file: string) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      by: "operator",
      reason: "lockfile incident",
      since: "2026-01-01T00:00:00.000Z",
    }),
  );
}

// [sessions] pause_file keeps the pause where another tool already pauses the same work, so
// that tool's pause stops pmcp's sessions and delivery, and pmcp's pause stops that tool.
describe("[sessions] pause_file", () => {
  it("takes absolute, ~/ and ${gate_dir}/ paths and refuses relative ones", () => {
    expect(
      readStoreSettings({ pause_file: "${gate_dir}/pause.json" }).pauseFile,
    ).toBe("${gate_dir}/pause.json");
    expect(
      readStoreSettings({ pause_file: "~/gate/pause.json" }).pauseFile,
    ).toBe(join(homedir(), "gate/pause.json"));
    expect(readStoreSettings({}).pauseFile).toBeUndefined();
    expect(() => readStoreSettings({ pause_file: "gate/pause.json" })).toThrow(
      "[sessions] pause_file must be absolute",
    );
  });

  it("is where pmcp sessions pause writes and status reads", async (t) => {
    const root = temp(t);
    writeFileSync(
      join(root, "pmcp.toml"),
      [
        "[sessions]",
        'state_dir = ".state"',
        'pause_file = "${gate_dir}/pause.json"',
        "[git.mainline.gate]",
        'tree = "/nonexistent/gate/tree"',
        'tree_env = "GATE_TREE"',
        "",
      ].join("\n"),
    );
    const gateDir = join(root, "gate");
    const run = async (...argv: string[]) => {
      let output = "";
      const capture = { write: (text: string) => void (output += text) };
      const ui = new Ui({ stdout: capture, stderr: capture });
      const code = await dispatch(argv, {
        cwd: root,
        env: { HOME: root, GATE_TREE: join(gateDir, "tree") },
        ui,
      });
      return { code, output };
    };
    expect((await run("sessions", "pause", "deploy", "--by", "kit")).code).toBe(
      0,
    );
    const file = join(gateDir, "pause.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      by: "kit",
      reason: "deploy",
    });
    expect(existsSync(join(root, ".state/pause.json"))).toBe(false);
    await run("sessions", "resume");
    expect(existsSync(file)).toBe(false);

    foreignPause(file);
    expect((await run("sessions", "status")).output).toMatch(
      /PAUSED by operator .*lockfile incident/u,
    );
  });

  it("is the pause git deliver and sync refuse on", (t) => {
    const base = temp(t);
    const root = join(base, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    writeFileSync(
      join(root, "pmcp.toml"),
      [
        "[sessions]",
        'state_dir = ".state"',
        'pause_file = "${gate_dir}/pause.json"',
        "[git]",
        "[git.mainline.gate]",
        `tree = "${join(base, "gate/tree")}"`,
        'tree_env = "GATE_TREE"',
        "",
      ].join("\n"),
    );
    const moved = join(base, "elsewhere/tree");
    const setup = loadGit(root, undefined, { GATE_TREE: moved });
    if (setup instanceof Error) throw setup;
    expect(setup.pauseFile).toBe(join(base, "elsewhere/pause.json"));
    const gate = filesSessionGate(
      setup.stateDir,
      setup.leaseFiles,
      setup.pauseFile,
    );
    expect(gate.pause.read()).toBeNull();
    foreignPause(join(base, "elsewhere/pause.json"));
    expect(gate.pause.read()).toMatchObject({ reason: "lockfile incident" });
  });

  it("is the pause the projected hooks enforce and report", (t) => {
    const root = temp(t);
    const file = join(root, "gate/pause.json");
    writeFileSync(
      join(root, "pmcp.toml"),
      [
        '[targets]\ntools = ["claude"]\n',
        "[sessions]",
        'state_dir = ".state"',
        `pause_file = "${file}"`,
        "[sessions.registry]",
        "[sessions.pause]",
        "",
      ].join("\n"),
    );
    const result = project(readSpec(readConfig(join(root, "pmcp.toml"))), {
      check: false,
    });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    const hook = join(root, ".agents/pmcp-hooks/hook.mjs");
    const env = { ...process.env, XDG_STATE_HOME: join(root, ".xdg") };
    const answer = spawnSync(process.execPath, [hook, "--pause-file"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    expect(answer.stdout.trim()).toBe(file);

    const adapter = RUNTIMES.claude;
    const edit = () => {
      const payload = adapter.synthetic({
        cwd: root,
        session: "abcd1234-session",
        event: adapter.nativeEvent("before_tool")!,
        path: join(root, "a.txt"),
        tool: "edit",
      });
      const run = spawnSync(process.execPath, [hook, "claude", "before_tool"], {
        cwd: root,
        input: JSON.stringify(payload),
        encoding: "utf8",
        env,
      });
      return adapter.readVerdict(run.stdout);
    };
    expect(edit()).toBe("allow");
    foreignPause(file);
    expect(edit()).toBe("deny");
  });
});
