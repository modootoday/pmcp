import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Group } from "../src/harness/contracts.js";
import { inspectStartupRecovery } from "../src/tui/startup/recovery.js";
import {
  ensureStartupDirectory,
  saveStartup,
  startupFile,
} from "../src/tui/startup/state.js";

const mocks = vi.hoisted(() => ({ group: {} as Group }));
vi.mock("../src/harness/groups/store.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  GroupStore: class {
    readonly path: string;
    readonly state = { group: mocks.group };
    constructor(path: string) {
      this.path = path;
    }
  },
}));

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pmcp-startup-recovery-"));
  vi.stubEnv("XDG_STATE_HOME", join(cwd, "state"));
  mocks.group = {
    projectRoot: cwd,
    generation: "owned-generation",
    state: "ready",
  } as Group;
  ensureStartupDirectory(startupFile(cwd));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

function save(phase: "creating" | "starting" | "ready" = "starting") {
  saveStartup(startupFile(cwd), {
    schemaVersion: 1,
    projectRoot: cwd,
    runtime: "codex-cli",
    phase,
    ...(phase !== "creating"
      ? {
          groupFile: join(cwd, "group's state.json"),
          generation: "owned-generation",
          viewFile: join(cwd, "view.json"),
        }
      : {}),
  });
}

it("keeps creation without ownership evidence pending and unchanged", () => {
  save("creating");
  const before = readFileSync(startupFile(cwd));
  expect(inspectStartupRecovery({ cwd })).toMatchObject({
    status: "manual-inspection",
    commands: [],
    providerInvoked: false,
    runtimeRestarted: false,
    inputReplayed: false,
  });
  expect(readFileSync(startupFile(cwd))).toEqual(before);
});

it("offers exact shell-safe inspection and stop instructions without invoking them", () => {
  save();
  const before = readFileSync(startupFile(cwd));
  const receipt = inspectStartupRecovery({ cwd });
  expect(receipt.status).toBe("starting");
  expect(receipt.observedNativeProcesses).toBe(false);
  const commands = receipt.commands as string[];
  expect(commands[0]).toContain("'--include-starts'");
  expect(commands[0]).toContain("group'\\''s state.json");
  expect(commands[1]).toContain("'stop'");
  expect(commands[1]).toContain("'owned-generation'");
  expect(readFileSync(startupFile(cwd))).toEqual(before);
});

it("preserves paused work and labels resume as an explicit decision", () => {
  save("ready");
  mocks.group.state = "paused";
  expect(inspectStartupRecovery({ cwd })).toMatchObject({
    status: "paused",
    commandsRequireExplicitAction: true,
  });
  expect(mocks.group.state).toBe("paused");
});

it("does not supply recovery commands for stale or foreign group ownership", () => {
  save();
  mocks.group.generation = "replacement-generation";
  expect(() => inspectStartupRecovery({ cwd })).toThrow(
    "stale_group_generation",
  );
  mocks.group.projectRoot = "/foreign";
  expect(() => inspectStartupRecovery({ cwd })).toThrow(
    "startup_project_mismatch",
  );
});

it("preserves an explicitly selected configuration in a stopped group's fresh-launch command", () => {
  const config = join(cwd, "selected config.toml");
  writeFileSync(config, "[tui]\nruntime = 'codex-cli'\n");
  save("ready");
  mocks.group.state = "stopped";
  const receipt = inspectStartupRecovery({ cwd, config });
  expect(receipt.commands).toContain(
    `'pmcp' 'tui' '--new' '--config' '${config}'`,
  );
  expect(mocks.group.state).toBe("stopped");
});
