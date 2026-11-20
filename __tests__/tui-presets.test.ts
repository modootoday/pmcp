import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/command.js";
import { parseTui } from "../src/commands/tui/invocation.js";
import { tuiOptions } from "../src/commands/tui/options.js";
import { startupSettings } from "../src/tui/startup/config.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-tui-preset-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("tui presets", () => {
  it("parses --preset on launch and plan", () => {
    const launch = parseTui(parseArgs(["--preset", "pm-dev"], tuiOptions));
    expect(launch.startup?.preset).toBe("pm-dev");

    const plan = parseTui(
      parseArgs(["plan", "--preset", "pm-dev", "--json"], tuiOptions),
    );
    expect(plan.startup?.preset).toBe("pm-dev");
  });

  it("loads [tui.presets.<name>] with workers from pmcp.toml", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "pmcp.toml"),
      [
        "[tui]",
        'runtime = "codex-cli"',
        "[tui.presets.pm-dev]",
        'runtime = "agy"',
        "memory_mb = 3072",
        "session_memory_mb = 1024",
        "max_active = 2",
        "uncapped = true",
        "[[tui.presets.pm-dev.workers]]",
        'runtime = "claude"',
        "memory_mb = 1024",
        "",
      ].join("\n"),
    );
    const settings = startupSettings({ cwd: dir, preset: "pm-dev" });
    expect(settings.runtime).toBe("antigravity");
    expect(settings.preset).toBe("pm-dev");
    expect(settings.memoryMb).toBe(3072);
    expect(settings.sessionMemoryMb).toBe(1024);
    expect(settings.uncapped).toBe(true);
    expect(settings.workers).toEqual([
      { runtime: "claude-code", memoryMb: 1024 },
    ]);
  });

  it("rejects an unknown preset name", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "pmcp.toml"), '[tui]\nruntime = "agy"\n');
    expect(() => startupSettings({ cwd: dir, preset: "missing" })).toThrow(
      /unknown preset missing/,
    );
  });
});
