import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Group } from "../src/harness/contracts.js";
import { startWorkspaceWorker } from "../src/tui/startup/worker.js";
import {
  ensureStartupDirectory,
  saveStartup,
  startupFile,
} from "../src/tui/startup/state.js";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), group: {} as Group }));
vi.mock("../src/harness/application/invoke.js", () => ({
  invoke: mocks.invoke,
}));
vi.mock("../src/harness/adapters/process/executable.js", () => ({
  locateExecutable: () => "/fixture/runtime",
}));
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
  cwd = mkdtempSync(join(tmpdir(), "pmcp-startup-worker-"));
  vi.stubEnv("XDG_STATE_HOME", join(cwd, "state"));
  mocks.group = {
    projectRoot: cwd,
    generation: "owned-generation",
    state: "ready",
    profile: "native",
  } as Group;
  ensureStartupDirectory(startupFile(cwd));
  saveStartup(startupFile(cwd), {
    schemaVersion: 1,
    projectRoot: cwd,
    runtime: "codex-cli",
    phase: "ready",
    groupFile: join(cwd, "group.json"),
    viewFile: join(cwd, "view.json"),
    generation: "owned-generation",
  });
  mocks.invoke.mockResolvedValue({
    ok: true,
    sessions: [{ role: "main", alive: true }],
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

it("uses normal harness admission with the owned generation and default reservation", async () => {
  await startWorkspaceWorker({ cwd }, "gemini-cli");
  expect(mocks.invoke).toHaveBeenLastCalledWith({
    family: "session",
    action: "start",
    groupFile: join(cwd, "group.json"),
    generation: "owned-generation",
    input: { runtime: "gemini-cli", role: "worker", memoryMb: 768 },
  });
});

it("never starts a worker for paused, stale or absent-main workspaces", async () => {
  mocks.group.state = "paused";
  await expect(startWorkspaceWorker({ cwd }, "gemini-cli")).rejects.toThrow(
    "startup_group_paused",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.group.state = "ready";
  mocks.group.generation = "changed";
  await expect(startWorkspaceWorker({ cwd }, "gemini-cli")).rejects.toThrow(
    "stale_group_generation",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.group.generation = "owned-generation";
  mocks.invoke.mockResolvedValue({
    ok: true,
    sessions: [{ role: "main", alive: false }],
  });
  await expect(startWorkspaceWorker({ cwd }, "gemini-cli")).rejects.toThrow(
    "startup_main_unavailable",
  );
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
