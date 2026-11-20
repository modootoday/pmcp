import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNativeHost,
  uncappedRequested,
} from "../src/harness/adapters/systemd/admission.js";
import { parseTui } from "../src/commands/tui/invocation.js";
import { startupSettings } from "../src/tui/startup/config.js";
import { dependencies } from "../src/tui/startup/dependencies.js";
import { parseArgs } from "../src/cli/command.js";
import { tuiOptions } from "../src/commands/tui/options.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-tui-uncapped-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.PMCP_TUI_UNCAPPED;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("tui --uncapped fallback", () => {
  it("parses --uncapped on launch, plan, and doctor", () => {
    const launch = parseTui(parseArgs(["--uncapped"], tuiOptions));
    expect(launch.action).toBe("launch");
    expect(launch.startup?.uncapped).toBe(true);

    const plan = parseTui(
      parseArgs(["plan", "--uncapped", "--json"], tuiOptions),
    );
    expect(plan.action).toBe("plan");
    expect(plan.startup?.uncapped).toBe(true);

    const doctor = parseTui(
      parseArgs(["doctor", "--uncapped", "--json"], tuiOptions),
    );
    expect(doctor.action).toBe("doctor");
    expect(doctor.startup?.uncapped).toBe(true);
  });

  it("reads [tui] uncapped from pmcp.toml and respects env opt-in", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "pmcp.toml"),
      '[tui]\nruntime = "antigravity"\nuncapped = true\n',
    );
    const settings = startupSettings({ cwd: dir });
    expect(settings.runtime).toBe("antigravity");
    expect(settings.uncapped).toBe(true);

    expect(uncappedRequested({})).toBe(false);
    expect(uncappedRequested({ PMCP_TUI_UNCAPPED: "1" })).toBe(true);
  });

  it("reports memoryCapped false when uncapped is opted in", () => {
    const deps = dependencies({ uncapped: true });
    expect(deps.memoryCapped).toBe(false);
    if (process.platform === "linux" && deps.pmcpPty) {
      expect(() => assertNativeHost({ uncapped: true })).not.toThrow();
    }
  });
});
