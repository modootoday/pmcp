import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  met,
  parseCondition,
  processMatching,
  waitFor,
} from "../../src/lease/wait.js";
import { pmcpSync, scratch, until } from "./fixture.js";

describe("pmcp wait", () => {
  it("reads shell-free conditions only", () => {
    expect(parseCondition("exists:/tmp/x")).toEqual({
      kind: "exists",
      path: "/tmp/x",
    });
    expect(parseCondition("gone:/tmp/x")).toEqual({
      kind: "gone",
      path: "/tmp/x",
    });
    expect(parseCondition("load-below:4.5")).toEqual({
      kind: "load-below",
      max: 4.5,
    });
    expect(parseCondition("no-process:vitest")).toEqual({
      kind: "no-process",
      text: "vitest",
    });
    for (const bad of ["load-below:0", "exists:", "pgrep -f x", "run:sh"])
      expect(parseCondition(bad)).toBeNull();
  });

  it("never waits on itself or the shells that started it", () => {
    expect(met({ kind: "pid", pid: process.pid })).toBe(true);
    const marker = `pmcp-wait-self-${process.pid}`;
    expect(processMatching(marker)).toBeNull();
    const other = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30000)", marker],
      { stdio: "ignore" },
    );
    try {
      until(() => processMatching(marker) !== null);
      expect(processMatching(marker)).toBe(other.pid);
      expect(processMatching(" ")).not.toBeNull();
    } finally {
      other.kill();
    }
  });

  it("returns once every condition holds, or false at the timeout", async () => {
    const { base } = scratch();
    const flag = join(base, "flag");
    setTimeout(() => writeFileSync(flag, ""), 200);
    const ready = await waitFor({
      conditions: [
        { kind: "exists", path: flag },
        { kind: "load-below", max: 1 },
      ],
      timeout: 5,
      interval: 0.05,
      loadavg: join(base, "loadavg"),
      say: () => {},
    });
    expect(ready).toBe(true);
    const never = await waitFor({
      conditions: [{ kind: "gone", path: flag }],
      timeout: 0.2,
      interval: 0.05,
      say: () => {},
    });
    expect(never).toBe(false);
  });

  it("exits 0 when met, 75 at the timeout and 2 for an unreadable condition", () => {
    const { base, env } = scratch();
    const flag = join(base, "flag");
    writeFileSync(flag, "");
    expect(
      pmcpSync(["wait", "--until", `exists:${flag}`], base, env).status,
    ).toBe(0);
    expect(
      pmcpSync(
        [
          "wait",
          "--until",
          `gone:${flag}`,
          "--timeout",
          "1",
          "--interval",
          "0.2",
        ],
        base,
        env,
      ).status,
    ).toBe(75);
    expect(pmcpSync(["wait", "--until", "pgrep x"], base, env).status).toBe(2);
    expect(pmcpSync(["wait", "--pid", "999999999"], base, env).status).toBe(0);
    const self = `no-process:pmcp-wait-cli-${process.pid}`;
    expect(
      pmcpSync(["wait", "--until", self, "--timeout", "2"], base, env).status,
    ).toBe(0);
  }, 30_000);
});
