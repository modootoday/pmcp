import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGroup } from "../src/harness/groups/service.js";
import { command } from "../src/harness/adapters/process/command.js";
import { locateExecutable } from "../src/harness/adapters/process/executable.js";

vi.mock("../src/harness/adapters/process/command.js", () => ({
  command: vi.fn(),
}));
vi.mock("../src/harness/adapters/process/executable.js", () => ({
  locateExecutable: vi.fn(),
}));

let directory: string;

beforeEach(() => {
  vi.resetAllMocks();
  directory = mkdtempSync(join(tmpdir(), "pmcp-admission-"));
  vi.stubEnv("XDG_STATE_HOME", join(directory, "state"));
  vi.mocked(locateExecutable).mockReturnValue("/tool");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function create(): Promise<unknown> {
  return createGroup({
    projectRoot: directory,
    allowedRuntimes: ["codex-cli"],
    memoryMb: 128,
    maxActive: 1,
  });
}

function expectNoGroupState(): void {
  expect(existsSync(join(directory, "state/pmcp/harness"))).toBe(false);
}

it.skipIf(process.platform !== "linux")(
  "refuses absent native tools without creating group state or contacting the manager",
  async () => {
    vi.mocked(locateExecutable).mockReturnValue(null);
    await expect(create()).rejects.toThrow("native_host_tool_unavailable:tmux");
    expect(command).not.toHaveBeenCalled();
    expectNoGroupState();
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses an unreachable user manager without creating group state",
  async () => {
    vi.mocked(command).mockImplementation(() => {
      throw new Error("fixture manager unavailable");
    });
    await expect(create()).rejects.toThrow("native_user_manager_unavailable");
    expect(command).toHaveBeenCalledExactlyOnceWith(
      "systemctl",
      ["--user", "show", "--property=Version", "--value"],
      { timeout: 5_000 },
    );
    expectNoGroupState();
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses an empty user-manager response before group state creation",
  async () => {
    vi.mocked(command).mockReturnValue("\n");
    await expect(create()).rejects.toThrow("native_user_manager_unavailable");
    expectNoGroupState();
  },
);
