import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../src/config.js";
import { project } from "../src/project/apply.js";
import { HOST_MANIFEST, HOST_POLICY, hostDoctor } from "../src/project/host.js";
import { readSpec } from "../src/project/spec.js";

const HOST = `
[host]
roots = ["work"]
mcp_write = true

[[host.sessions]]
name = "lead"
runtime = "claude"
cwd = "work/app"
labels = { task = "review" }
restart = "on-exit"

[[host.sessions]]
name = "helper"
runtime = "codex"
cwd = "work"
argv = ["codex", "-m", "gpt-5"]

[[host.answers]]
runtime = "gemini"
dialog = "tool-approval"
options = ["Allow once"]
`;

function root(t: TestContext, toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-host-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "pmcp.toml"), toml);
  return dir;
}

const spec = (dir: string) => readSpec(readConfig(join(dir, "pmcp.toml")));

describe("[host] in pmcp.toml", () => {
  it("projects a lock-pinned manifest and policy in pmcp-pty's own field names", (t) => {
    const dir = root(t, HOST);
    expect(project(spec(dir), { check: false }).code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, HOST_MANIFEST), "utf8"));
    expect(manifest.sessions[0]).toEqual({
      name: "lead",
      profile: "claude",
      cwd: "work/app",
      argv: ["claude"],
      labels: { task: "review", "pmcp.host": "lead" },
      restart: "on-exit",
      max_restarts: 3,
      delivery_setup: true,
    });
    expect(manifest.sessions[1].argv).toEqual(["codex", "-m", "gpt-5"]);
    const policy = JSON.parse(readFileSync(join(dir, HOST_POLICY), "utf8"));
    expect(policy).toEqual({
      version: 1,
      mcp_write: true,
      roots: ["work"],
      allow: [
        { profile: "gemini", dialog: "tool-approval", options: ["Allow once"] },
      ],
    });
    expect(readFileSync(join(dir, HOST_MANIFEST), "utf8")).not.toContain(dir);
    expect(project(spec(dir), { check: true }).code).toBe(0);
    expect(hostDoctor(spec(dir))[0]).toMatchObject({ status: "ok" });
    writeFileSync(join(dir, HOST_POLICY), '{"mcp_write": true, "allow": []}\n');
    expect(hostDoctor(spec(dir))[0]).toMatchObject({ status: "fail" });
  });

  it("removes the projected files when [host] goes away", (t) => {
    const dir = root(t, HOST);
    project(spec(dir), { check: false });
    writeFileSync(join(dir, "pmcp.toml"), "");
    expect(project(spec(dir), { check: false }).code).toBe(0);
    expect(existsSync(join(dir, HOST_MANIFEST))).toBe(false);
    expect(hostDoctor(spec(dir))).toEqual([]);
  });

  it("projects browser and desktop widening only when declared", (t) => {
    const plain = root(t, HOST);
    project(spec(plain), { check: false });
    const before = JSON.parse(readFileSync(join(plain, HOST_POLICY), "utf8"));
    expect(before.browser).toBeUndefined();
    expect(before.desktop).toBeUndefined();
    const extra = `${HOST}\n[host.browser]\nallow_private = ["localhost:5173"]\n\n[[host.desktop.launch]]\nname = "term"\nargv = ["xterm"]\n`;
    const wide = root(t, extra);
    project(spec(wide), { check: false });
    const policy = JSON.parse(readFileSync(join(wide, HOST_POLICY), "utf8"));
    expect(policy.browser).toEqual({ allow_private: ["localhost:5173"] });
    expect(policy.desktop).toEqual({
      launch: [{ name: "term", argv: ["xterm"] }],
    });
  });

  it("turns on shell.host_approval, unless the project sets it itself", (t) => {
    const ids = (toml: string) =>
      spec(root(t, toml)).hookBundle?.policy?.guards.map((g) => g.id) ?? [];
    expect(ids(HOST)).toContain("shell.host_approval");
    const off = `${HOST}\n[hooks.guards.shell]\nhost_approval = { mode = "off" }\n`;
    expect(ids(off)).not.toContain("shell.host_approval");
    expect(ids("")).not.toContain("shell.host_approval");
  });

  it.each([
    [
      '[[host.answers]]\nruntime = "claude"\ndialog = "auth-login"\noptions = ["1"]',
      "never answered",
    ],
    [
      '[[host.answers]]\nruntime = "codex"\ndialog = "folder-trust"\noptions = ["1"]',
      "never answered",
    ],
    [
      '[[host.answers]]\nruntime = "grok"\ndialog = "hooks-review"\noptions = ["1"]',
      "never answered",
    ],
    [
      '[[host.sessions]]\nname = "a"\nruntime = "claude"\ncwd = "/tmp"',
      "inside the project",
    ],
    [
      '[[host.sessions]]\nname = "a"\nruntime = "claude"\ncwd = "../x"',
      "inside the project",
    ],
    [
      '[host]\nroots = ["work"]\n[[host.sessions]]\nname = "a"\nruntime = "claude"\ncwd = "other"',
      "not under [host] roots",
    ],
    [
      '[[host.sessions]]\nname = "a"\nruntime = "claude"\n[[host.sessions]]\nname = "a"\nruntime = "codex"',
      "used twice",
    ],
    ['[[host.sessions]]\nname = "a"\nruntime = "vim"', "must be one of"],
    [
      '[[host.sessions]]\nname = "a"\nruntime = "claude"\nlabels = { "pmcp.host" = "x" }',
      "not starting with pmcp.",
    ],
    ["[host]\nanswer_everything = true", "unknown key"],
    [
      '[host.browser]\nallow_private = ["localhost"]',
      "use host:port or host:*",
    ],
    [
      '[[host.desktop.launch]]\nname = "web"\nargv = ["/usr/bin/chromium"]',
      "browsers are never launched",
    ],
    [
      '[[host.desktop.launch]]\nname = "ff"\nargv = ["firefox-esr"]',
      "browsers are never launched",
    ],
  ])("refuses %s", (toml, message) => {
    expect(() => readSpec({ ...readConfigFrom(toml) })).toThrow(message);
  });
});

function readConfigFrom(toml: string) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-host-bad-"));
  try {
    writeFileSync(join(dir, "pmcp.toml"), toml);
    return readConfig(join(dir, "pmcp.toml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
