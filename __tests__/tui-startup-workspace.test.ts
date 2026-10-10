import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Group } from "../src/harness/contracts.js";
import type { View } from "../src/tui/contracts.js";
import { prepareWorkspace } from "../src/tui/startup/workspace.js";
import {
  ensureStartupDirectory,
  readStartup,
  saveStartup,
  startupFile,
} from "../src/tui/startup/state.js";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createView: vi.fn(),
  groups: new Map<string, Group>(),
  views: new Map<string, View>(),
}));
vi.mock("../src/harness/application/invoke.js", () => ({
  invoke: mocks.invoke,
}));
vi.mock("../src/tui/application/create.js", () => ({
  createView: mocks.createView,
}));
vi.mock("../src/tui/state/store.js", () => ({
  readView: (file: string) => ({ file, view: mocks.views.get(file) }),
}));
vi.mock("../src/harness/groups/store.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  GroupStore: class {
    readonly path: string;
    readonly state: { group: Group };
    constructor(file: string) {
      this.path = file;
      this.state = { group: mocks.groups.get(file)! };
    }
  },
}));

let cwd: string;
let groupFile: string;
let viewFile: string;
let group: Group;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pmcp-startup-flow-"));
  vi.stubEnv("XDG_STATE_HOME", join(cwd, "state"));
  groupFile = join(cwd, "group.json");
  viewFile = join(cwd, "view.json");
  group = {
    schemaVersion: 1,
    owner: "fixture-owner",
    id: "fixture-group",
    generation: "fixture-generation",
    projectRoot: cwd,
    allowedRuntimes: ["codex-cli"],
    profile: "native",
    state: "ready",
    memoryMb: 2048,
    maxActive: 2,
    sessions: [],
  };
  mocks.groups.set(groupFile, group);
  mocks.invoke.mockImplementation(async (operation) => {
    if (operation.family === "group") return { ok: true, groupFile, group };
    if (operation.action === "start")
      return { ok: true, session: { id: "fixture-main" } };
    return {
      ok: true,
      sessions: [
        { id: "fixture-main", role: "main", runtime: "codex-cli", alive: true },
      ],
    };
  });
  mocks.createView.mockImplementation(async () => {
    writeFileSync(viewFile, "fixture");
    mocks.views.set(viewFile, {
      state: "open",
      groupFile,
      generation: group.generation,
    } as View);
    return { ok: true, viewFile };
  });
  ensureStartupDirectory(startupFile(cwd));
});
afterEach(() => {
  mocks.groups.clear();
  mocks.views.clear();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

it("creates through the harness contract and reopens without another runtime start", async () => {
  const receipt = await prepareWorkspace({ cwd, runtime: "codex-cli" });
  expect(receipt).toMatchObject({
    ok: true,
    groupFile,
    viewFile,
    readOnly: true,
  });
  expect(
    mocks.invoke.mock.calls.map(
      ([operation]) => `${operation.family}:${operation.action}`,
    ),
  ).toEqual(["group:create", "session:start", "session:list"]);
  mocks.invoke.mockClear();
  await prepareWorkspace({ cwd });
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith(
    expect.objectContaining({ action: "list" }),
  );
  expect(mocks.createView).toHaveBeenCalledTimes(1);
});

it("retains an interrupted native start and refuses automatic retry", async () => {
  mocks.invoke.mockImplementationOnce(async () => ({
    ok: true,
    groupFile,
    group,
  }));
  mocks.invoke.mockRejectedValueOnce(new Error("fixture_start_interrupted"));
  await expect(prepareWorkspace({ cwd })).rejects.toThrow(
    "fixture_start_interrupted",
  );
  expect(readStartup(startupFile(cwd), cwd)).toMatchObject({
    phase: "starting",
    groupFile,
  });
  mocks.invoke.mockClear();
  await expect(prepareWorkspace({ cwd })).rejects.toThrow(
    "startup_requires_recovery",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("retries presentation creation without restarting a successful main", async () => {
  mocks.createView.mockRejectedValueOnce(new Error("fixture_view_failure"));
  await expect(prepareWorkspace({ cwd })).rejects.toThrow(
    "fixture_view_failure",
  );
  expect(readStartup(startupFile(cwd), cwd)?.phase).toBe("view-pending");
  mocks.invoke.mockClear();
  expect(await prepareWorkspace({ cwd })).toMatchObject({ ok: true, viewFile });
  expect(
    mocks.invoke.mock.calls.map(([operation]) => operation.action),
  ).toEqual(["list"]);
});

it("allows an explicit fresh launch after stopping an interrupted owned group", async () => {
  saveStartup(startupFile(cwd), {
    schemaVersion: 1,
    projectRoot: cwd,
    runtime: "codex-cli",
    phase: "starting",
    groupFile,
    generation: group.generation,
  });
  await expect(prepareWorkspace({ cwd, fresh: true })).rejects.toThrow(
    "workspace_already_running",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  group.state = "stopped";
  expect(await prepareWorkspace({ cwd, fresh: true })).toMatchObject({
    ok: true,
    viewFile,
  });
  expect(
    mocks.invoke.mock.calls.map(
      ([operation]) => `${operation.family}:${operation.action}`,
    ),
  ).toEqual(["group:create", "session:start", "session:list"]);
});

it("preserves paused groups and refuses a fresh-launch override", async () => {
  saveStartup(startupFile(cwd), {
    schemaVersion: 1,
    projectRoot: cwd,
    runtime: "codex-cli",
    groupFile,
    generation: group.generation,
    viewFile,
    phase: "ready",
  });
  group.state = "paused";
  await expect(prepareWorkspace({ cwd, fresh: true })).rejects.toThrow(
    "startup_group_paused",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(readStartup(startupFile(cwd), cwd)?.groupFile).toBe(groupFile);
});

it("rejects a stale generation or foreign project without adopting it", async () => {
  saveStartup(startupFile(cwd), {
    schemaVersion: 1,
    projectRoot: cwd,
    runtime: "codex-cli",
    groupFile,
    generation: "old-generation",
    viewFile,
    phase: "ready",
  });
  await expect(prepareWorkspace({ cwd })).rejects.toThrow(
    "stale_group_generation",
  );
  group.projectRoot = "/foreign";
  await expect(prepareWorkspace({ cwd })).rejects.toThrow(
    "startup_project_mismatch",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("refuses replacing a live owned workspace", async () => {
  await prepareWorkspace({ cwd });
  mocks.invoke.mockClear();
  await expect(prepareWorkspace({ cwd, fresh: true })).rejects.toThrow(
    "workspace_already_running",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});
