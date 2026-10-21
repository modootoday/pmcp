import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../src/config.js";
import { project } from "../../src/project/apply.js";
import { featureRows } from "../../src/project/features.js";
import { readSpec } from "../../src/project/spec.js";

const TOML = [
  '[targets]\ntools = ["claude", "codex"]\n',
  '[sessions]\nstate_dir = ".state"\n',
  "[sessions.pause]\n",
  '[sessions.roles.lander]\nallow_commands = [["git", "log"]]\n',
  "[hooks.guards.shell.heredoc]\n",
  '[hooks.guards.shell.stdin_interpreter]\nmode = "ask"\n',
].join("\n");

function workspace(t: TestContext, git: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-doctor-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  if (git) execFileSync("git", ["init", "-q", "-b", "main", root]);
  writeFileSync(join(root, "pmcp.toml"), TOML);
  const spec = () => readSpec(readConfig(join(root, "pmcp.toml")));
  const result = project(spec(), { check: false });
  if (result.backup)
    t.onTestFinished(() =>
      rmSync(result.backup!, { recursive: true, force: true }),
    );
  return { root, spec };
}

const row = (rows: ReturnType<typeof featureRows>, feature: string) =>
  rows.find((entry) => entry.feature === feature)!;

describe("doctor feature x runtime table", () => {
  it("names the source of each feature and whether it is projected", (t) => {
    const { root, spec } = workspace(t, true);
    const rows = featureRows(spec(), { home: root, env: {} });
    expect(row(rows, "shell.heredoc")).toMatchObject({
      enabled: "toml",
      projected: "yes",
      claude: "measured",
      codex: "measured",
    });
    expect(row(rows, "git.shared_checkout")).toMatchObject({
      enabled: "auto",
      projected: "yes",
    });
    expect(row(rows, "git.push_without_verify")).toMatchObject({
      enabled: "default-off",
      projected: "-",
      claude: "-",
    });
    writeFileSync(join(root, ".agents/pmcp-hooks/policy.json"), "{}\n");
    expect(
      row(featureRows(spec(), { home: root, env: {} }), "shell.heredoc")
        .projected,
    ).toBe("drift");
  });

  it("leaves shared checkout off without git and reports measured support from the capability files", (t) => {
    const { root, spec } = workspace(t, false);
    const rows = featureRows(spec(), { home: root, env: {} });
    expect(row(rows, "git.shared_checkout")).toMatchObject({
      enabled: "default-off",
    });
    expect(row(rows, "sessions.roles").codex).toBe("unsupported");
    expect(row(rows, "shell.stdin_interpreter").codex).toMatch(
      /\(ask->deny\)$/u,
    );
  });

  it("reads Codex trust from config.toml without writing it", (t) => {
    const { root, spec } = workspace(t, false);
    mkdirSync(join(root, ".codex-home"));
    const hooks = join(root, ".codex/hooks.json");
    const config = join(root, ".codex-home/config.toml");
    writeFileSync(
      config,
      `[hooks.state."${hooks}:pre_tool_use:0:0"]\ntrusted_hash = "sha256:x"\n`,
    );
    const env = { CODEX_HOME: join(root, ".codex-home") };
    const rows = featureRows(spec(), { home: root, env });
    expect(row(rows, "shell.heredoc").codexTrust).toBe("trusted");
    expect(row(rows, "sessions.pause").codexTrust).toBe("untrusted");
    expect(readFileSync(config, "utf8")).toContain("trusted_hash");
  });
});
