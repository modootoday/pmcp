import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { dispatch } from "../src/commands/index.js";
import { Ui } from "../src/cli/ui.js";
import { readConfig } from "../src/config.js";
import { memoryFindings } from "../src/project/memory.js";
import { readSpec } from "../src/project/spec.js";
import type { DoctorOptions } from "../src/project/doctor.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-memory-"));
  const home = join(root, "home");
  mkdirSync(home);
  const config = join(root, "pmcp.toml");
  writeFileSync(
    config,
    '[targets]\ntools = ["claude", "codex", "gemini", "grok", "antigravity"]\n',
  );
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const calls: string[][] = [];
  const options: DoctorOptions = {
    home,
    run: (command, args) => {
      calls.push([command, ...args]);
      return {
        missing: false,
        status: 0,
        stdout: command === "codex" ? "memories stable false\n" : "1.0",
      };
    },
  };
  return {
    root,
    home,
    config,
    calls,
    options,
    spec: readSpec(readConfig(config)),
  };
}

describe("read-only native memory metadata", () => {
  it("reports disabled Codex memory without inspecting memory bodies", (t) => {
    const { home, spec, options, calls } = fixture(t);
    mkdirSync(join(home, ".codex/memories"), { recursive: true });
    const body = join(home, ".codex/memories/MEMORY.md");
    writeFileSync(body, "fixture-private-memory");
    const result = memoryFindings(spec, {
      ...options,
      only: new Set(["codex"]),
    });
    expect(result[0]?.memory).toMatchObject({
      state: "disabled",
      exists: true,
      path: join(home, ".codex/memories"),
    });
    expect(JSON.stringify(result)).not.toContain("fixture-private-memory");
    expect(readFileSync(body, "utf8")).toBe("fixture-private-memory");
    expect(calls).toEqual([["codex", "features", "list"]]);
  });

  it("respects native home overrides and an explicit Claude memory path", (t) => {
    const { root, home, spec, options } = fixture(t);
    const settings = join(home, "custom-claude");
    mkdirSync(settings);
    writeFileSync(
      join(settings, "settings.json"),
      JSON.stringify({
        autoMemoryEnabled: true,
        autoMemoryDirectory: "~/custom-memory",
      }),
    );
    const findings = memoryFindings(spec, {
      ...options,
      env: {
        CLAUDE_CONFIG_DIR: settings,
        CODEX_HOME: join(root, "custom-codex"),
      },
    });
    expect(
      findings.find((entry) => entry.tool === "claude")?.memory,
    ).toMatchObject({
      state: "enabled",
      path: join(home, "custom-memory"),
      pathScope: "store",
      exists: false,
    });
    expect(findings.find((entry) => entry.tool === "codex")?.memory.path).toBe(
      join(root, "custom-codex/memories"),
    );
  });

  it("does not infer activation or workspace paths from directory existence", (t) => {
    const { home, spec, options } = fixture(t);
    mkdirSync(join(home, ".grok/memory-v2/workspaces"), { recursive: true });
    const result = memoryFindings(spec, options);
    expect(result.find((entry) => entry.tool === "grok")?.memory).toMatchObject(
      { state: "unknown", pathScope: "base", exists: true },
    );
    expect(
      result.find((entry) => entry.tool === "claude")?.memory,
    ).toMatchObject({ state: "unknown", pathScope: "base" });
    expect(
      result.find((entry) => entry.tool === "antigravity")?.memory,
    ).toMatchObject({ state: "unsupported" });
  });

  it("redacts malformed configuration and treats missing native tools as unknown", (t) => {
    const { home, spec, options } = fixture(t);
    mkdirSync(join(home, ".claude"));
    writeFileSync(
      join(home, ".claude/settings.json"),
      "fixture-private-broken-json",
    );
    const result = memoryFindings(spec, options);
    expect(result.find((entry) => entry.tool === "claude")?.memory.state).toBe(
      "unknown",
    );
    expect(JSON.stringify(result)).not.toContain("fixture-private-broken-json");
    const missing = memoryFindings(spec, {
      ...options,
      run: () => ({ missing: true, status: null, stdout: "" }),
    });
    expect(missing.find((entry) => entry.tool === "codex")?.memory.state).toBe(
      "unknown",
    );
  });

  it("keeps Gemini context filename metadata separate from activation", (t) => {
    const { home, spec, options } = fixture(t);
    mkdirSync(join(home, "custom-gemini"));
    writeFileSync(
      join(home, "custom-gemini/settings.json"),
      '{"context":{"fileName":["AGENTS.md","CONTEXT.md"]}}',
    );
    const result = memoryFindings(spec, {
      ...options,
      env: { GEMINI_CLI_HOME: join(home, "custom-gemini") },
      only: new Set(["gemini"]),
    });
    expect(result[0]?.memory).toMatchObject({
      state: "unknown",
      contextFileNames: ["AGENTS.md", "CONTEXT.md"],
      path: join(home, "custom-gemini/GEMINI.md"),
    });
  });

  it("keeps the legacy doctor output free of optional memory fields", async (t) => {
    const { root, config } = fixture(t);
    writeFileSync(config, "[targets]\ntools = []\n");
    let output = "";
    const ui = new Ui({
      stdout: {
        write: (text) => {
          output += text;
        },
      },
      stderr: { write: () => {} },
    });
    expect(
      await dispatch(["doctor", "--config", config, "--json"], {
        cwd: root,
        env: { HOME: root },
        ui,
      }),
    ).toBe(0);
    expect(JSON.parse(output)).toEqual({
      findings: [
        { tool: "project", check: "outputs match sources", status: "ok" },
      ],
    });
  });
});
