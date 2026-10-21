import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/logging/logger.js";

describe("JSONL logger", () => {
  it("writes fields in the fixed order and drops lines below its level", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line), "info", {
      component: "hook",
    }).child({ trace: "t1" });
    log.debug("hidden");
    log.info("shown", { verdict: "deny", duration_ms: 3, tool: "Bash" });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(Object.keys(record)).toEqual([
      "ts",
      "level",
      "component",
      "trace",
      "verdict",
      "duration_ms",
      "msg",
      "data",
    ]);
    expect(record.ts).toMatch(/Z$/u);
  });

  it("redacts secret values and keeps prompts as length and hash", () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line)).info("x", {
      token: "abc",
      prompt: "hello",
      nested: { password: "p" },
    });
    const data = JSON.parse(lines[0]!).data;
    expect(data.token).toBe("[redacted]");
    expect(data.nested.password).toBe("[redacted]");
    expect(data.prompt).toEqual({
      length: 5,
      sha256: expect.stringMatching(/^[0-9a-f]{16}$/u),
    });
  });

  it("never throws when the sink fails", () => {
    const log = createLogger(() => {
      throw new Error("disk full");
    });
    expect(() => log.error("x")).not.toThrow();
  });
});
