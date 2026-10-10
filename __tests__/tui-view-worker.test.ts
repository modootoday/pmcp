import { beforeEach, expect, it, vi } from "vitest";
import { startViewWorker } from "../src/tui/application/worker-start.js";
import type { View, Snapshot } from "../src/tui/contracts.js";
import { parseArgs, ArgumentError } from "../src/cli/command.js";
import { parseTui, tuiOptions } from "../src/commands/tui/invocation.js";

const mocks = vi.hoisted(() => ({
  view: {} as View,
  snapshot: {} as Snapshot,
  call: vi.fn(),
}));
vi.mock("../src/tui/application/context.js", () => ({
  openView: () => ({
    view: mocks.view,
    common: { snapshot: async () => mocks.snapshot, call: mocks.call },
  }),
}));
beforeEach(() => {
  mocks.call.mockReset();
  mocks.view = { state: "open", mainId: "main" } as View;
  mocks.snapshot = {
    group: { state: "ready" },
    sessions: [{ id: "main", role: "main", alive: true, memoryMb: 512 }],
  } as Snapshot;
});

it("uses the owned view contract and preserves the main reservation", async () => {
  await startViewWorker("owned.json", "gemini-cli");
  expect(mocks.call).toHaveBeenCalledWith("session", "start", {
    input: { role: "worker", runtime: "gemini-cli", memoryMb: 512 },
  });
  expect(
    parseTui(
      parseArgs(
        ["start-worker", "--view", "owned.json", "--runtime", "gemini-cli"],
        tuiOptions,
      ),
    ),
  ).toMatchObject({ action: "start-worker", viewFile: "owned.json" });
  expect(() =>
    parseTui(
      parseArgs(
        [
          "start-worker",
          "--view",
          "owned.json",
          "--config",
          "pmcp.toml",
          "--runtime",
          "gemini-cli",
        ],
        tuiOptions,
      ),
    ),
  ).toThrow(ArgumentError);
});

it("refuses closed, paused and absent-main views without worker admission", async () => {
  mocks.view.state = "closed";
  await expect(startViewWorker("owned.json", "gemini-cli")).rejects.toThrow(
    "view_closed",
  );
  mocks.view.state = "open";
  mocks.snapshot.group.state = "paused";
  await expect(startViewWorker("owned.json", "gemini-cli")).rejects.toThrow(
    "group_not_ready",
  );
  mocks.snapshot.group.state = "ready";
  mocks.snapshot.sessions[0]!.alive = false;
  await expect(startViewWorker("owned.json", "gemini-cli")).rejects.toThrow(
    "startup_main_unavailable",
  );
  expect(mocks.call).not.toHaveBeenCalled();
});
