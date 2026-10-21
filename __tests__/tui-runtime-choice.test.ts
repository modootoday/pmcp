import { expect, it, vi } from "vitest";
import {
  chooseRuntime,
  confirmRuntimeStart,
} from "../src/tui/presentation/runtime-choice.js";

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
