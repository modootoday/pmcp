import { afterEach, expect, test, vi } from "vitest";
import { findUser } from "./repository.js";
import { readUser } from "./service.js";

vi.mock(import("./repository.js"), () => ({
  findUser: vi.fn(async (id: string) => ({ id, name: "Ada" })),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("transforms the repository mock before loading its consumer", async () => {
  await expect(readUser("u1")).resolves.toBe("Ada");
  expect(findUser).toHaveBeenCalledTimes(1);
  expect(findUser).toHaveBeenCalledWith("u1");
});

test("awaits a repository rejection through the consumer", async () => {
  vi.mocked(findUser).mockRejectedValueOnce(new Error("unavailable"));
  await expect(readUser("u2")).rejects.toThrow("unavailable");
});

test("clears history while preserving a mock implementation", () => {
  const mock = vi.fn(() => "initial");
  expect(mock()).toBe("initial");
  mock.mockClear();
  expect(mock).not.toHaveBeenCalled();
  expect(mock()).toBe("initial");
});

test("resets a configured mock to its initial implementation", () => {
  const mock = vi.fn(() => "initial");
  mock.mockReturnValue("replacement");
  expect(mock()).toBe("replacement");
  mock.mockReset();
  expect(mock).not.toHaveBeenCalled();
  expect(mock()).toBe("initial");
});

test("restores the original method without clearing spy history", () => {
  const calculator = { add: (left: number, right: number) => left + right };
  const spy = vi.spyOn(calculator, "add").mockReturnValue(100);
  expect(calculator.add(1, 2)).toBe(100);
  vi.restoreAllMocks();
  expect(calculator.add(1, 2)).toBe(3);
  expect(spy).toHaveBeenCalledTimes(1);
});

test("advances promise-aware fake timers", async () => {
  vi.useFakeTimers();
  const callback = vi.fn();
  const pending = new Promise<string>((resolve) => {
    setTimeout(() => {
      callback();
      resolve("ready");
    }, 100);
  });

  expect(callback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toBe("ready");
  expect(callback).toHaveBeenCalledTimes(1);
});

test("restores a stubbed global explicitly", () => {
  const original = globalThis.fetch;
  const replacement = vi.fn();
  vi.stubGlobal("fetch", replacement);
  expect(globalThis.fetch).toBe(replacement);
  vi.unstubAllGlobals();
  expect(globalThis.fetch).toBe(original);
});

test.fails("rejects an intentionally incorrect expectation", () => {
  expect(2 + 2).toBe(5);
});
