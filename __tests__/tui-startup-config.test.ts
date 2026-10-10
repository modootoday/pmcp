import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { startupSettings } from "../src/tui/startup/config.js";
import {
  ensureStartupDirectory,
  readStartup,
  saveStartup,
  startupFile,
} from "../src/tui/startup/state.js";
import { parseArgs } from "../src/cli/command.js";
import { parseTui, tuiOptions } from "../src/commands/tui/invocation.js";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-startup-"));
  directories.push(directory);
  vi.stubEnv("XDG_STATE_HOME", join(directory, "state"));
  vi.stubEnv("PATH", directory);
  return directory;
}

it("uses bounded settings and no project file preparation", () => {
  const cwd = fixture();
  expect(startupSettings({ cwd })).toMatchObject({
    projectRoot: cwd,
    runtime: "codex-cli",
    memoryMb: 2048,
    sessionMemoryMb: 768,
    maxActive: 2,
  });
  expect(readStartup(startupFile(cwd), cwd)).toBeNull();
  expect(parseTui(parseArgs([], tuiOptions))).toMatchObject({
    action: "launch",
  });
  expect(
    parseTui(parseArgs(["--view", "owned.json"], tuiOptions)),
  ).toMatchObject({ action: "open", viewFile: "owned.json" });
});

it("finds the nearest config and resolves group paths relative to it", () => {
  const cwd = fixture();
  const nested = join(cwd, "nested");
  mkdirSync(nested);
  writeFileSync(
    join(cwd, "pmcp.toml"),
    '[tui]\nruntime = "gemini-cli"\ngroup_file = "state/group.json"\nmemory_mb = 1536\nsession_memory_mb = 512\nmax_active = 1\n',
  );
  expect(startupSettings({ cwd: nested })).toMatchObject({
    projectRoot: cwd,
    runtime: "gemini-cli",
    groupFile: join(cwd, "state/group.json"),
    memoryMb: 1536,
    sessionMemoryMb: 512,
    maxActive: 1,
  });
  expect(startupSettings({ cwd: nested, runtime: "grok-cli" }).runtime).toBe(
    "grok-cli",
  );
});

it.each([
  'tui = "wrong"',
  "[tui]\nunkown = true",
  '[tui]\nruntime = "unknown"',
  "[tui]\nmax_active = 1.5",
  "[tui]\nmemory_mb = 128\nsession_memory_mb = 256",
  "[tui]\ngroup_file = 1",
])("refuses malformed settings without changing the source: %s", (source) => {
  const cwd = fixture();
  const config = join(cwd, "pmcp.toml");
  writeFileSync(config, source);
  expect(() => startupSettings({ cwd })).toThrow("[tui]");
  expect(readFileSync(config, "utf8")).toBe(source);
});

it("keeps private project-specific checkpoints and refuses foreign state", () => {
  const cwd = fixture();
  const file = startupFile(cwd);
  expect(startupFile(join(cwd, "another"))).not.toBe(file);
  ensureStartupDirectory(file);
  saveStartup(file, {
    schemaVersion: 1,
    projectRoot: cwd,
    phase: "creating",
    runtime: "codex-cli",
  });
  expect(readStartup(file, cwd)?.phase).toBe("creating");
  expect(() => readStartup(file, "foreign")).toThrow("foreign_startup_state");
  chmodSync(file, 0o644);
  expect(() => readStartup(file, cwd)).toThrow("unsafe_state_file");
  chmodSync(dirname(file), 0o755);
  expect(() => ensureStartupDirectory(file)).toThrow(
    "unsafe_startup_directory",
  );
});
