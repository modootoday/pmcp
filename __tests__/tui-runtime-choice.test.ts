import { expect, it, vi } from "vitest";
import {
  chooseRuntime,
  confirmRuntimeStart,
} from "../src/tui/presentation/runtime-choice.js";
import { targetStatus } from "../src/tui/presentation/target.js";
import type { View } from "../src/tui/contracts.js";

it("ignores invalid selections and accepts only a listed runtime", async () => {
  const question = vi
    .fn()
    .mockResolvedValueOnce("9")
    .mockResolvedValueOnce("1x")
    .mockResolvedValueOnce("2");
  expect(
    await chooseRuntime({ question }, ["codex-cli", "gemini-cli"], "codex-cli"),
  ).toBe("gemini-cli");
  expect(question).toHaveBeenCalledTimes(3);
});

it("keeps cancellation and start confirmation separate from selection", async () => {
  const question = vi.fn().mockResolvedValue("q");
  expect(
    await chooseRuntime({ question }, ["codex-cli"], "codex-cli"),
  ).toBeUndefined();
  expect(await confirmRuntimeStart({ question }, "codex-cli")).toBe(false);
  question.mockResolvedValue("");
  expect(
    await chooseRuntime(
      { question },
      ["codex-cli", "gemini-cli"],
      "gemini-cli",
    ),
  ).toBe("gemini-cli");
  expect(await confirmRuntimeStart({ question }, "gemini-cli")).toBe(true);
});

it("shows input enabled only after a controlled writer is ready", () => {
  const view = {
    target: "worker-id",
    mainId: "main-id",
    phase: "read-only",
  } as View;
  expect(targetStatus(view)).toContain("WORKER worker-i | OBSERVE | INPUT OFF");
  view.phase = "connecting";
  expect(targetStatus(view)).toContain("CONNECTING WRITER | INPUT OFF");
  view.phase = "controlled";
  expect(targetStatus(view)).toContain("CONTROL READY | INPUT ON");
  view.target = view.mainId;
  view.phase = "uncertain";
  expect(targetStatus(view)).toContain(
    "MAIN main-id | CONTROL UNKNOWN / INPUT BLOCKED | INPUT OFF",
  );
});
