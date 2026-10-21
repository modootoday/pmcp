import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { gate as readGate } from "../../src/git/config/tables.js";
import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
} from "../../src/git/mainline/deliver.js";
import {
  commit,
  isolateGit,
  recorder,
  remote,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

// A gate started on a loaded host timed out and was rerun, doubling the load: deliver now
// waits, holding the lock, until the load is below max_load, and never retries the gate.
function run(origin: Remote, loads: number[], waitSeconds: number) {
  const marker = join(origin.base, "gate-ran");
  const reads: number[] = [];
  const report = recorder();
  const options: DeliverOptions = {
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 1,
      refuseDirectPush: true,
      duringPause: "refuse",
      leaseWaitSeconds: 1,
    },
    gate: {
      command: ["sh", "-c", `touch ${marker}`],
      lockWaitSeconds: 60,
      maxLoad: 6,
      loadWaitSeconds: waitSeconds,
    },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    loadavg: () => {
      const value = loads[Math.min(reads.length, loads.length - 1)]!;
      reads.push(value);
      return value;
    },
    loadPollMs: 10,
    report,
  };
  const code = deliver(options);
  return { code, ran: existsSync(marker), reads, lines: report.lines };
}

it("waits for the load to fall below max_load, then runs the gate once", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const { code, ran, reads, lines } = run(origin, [8, 8, 3], 60);
  expect(code).toBe(0);
  expect(ran).toBe(true);
  expect(reads).toEqual([8, 8, 3]);
  expect(lines).toContain("waiting for load 8.00 to fall below 6");
});

it("runs nothing and fails when the load stays high, leaving no holder behind", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const { code, ran, lines } = run(origin, [9], 1);
  expect(code).toBe(1);
  expect(ran).toBe(false);
  expect(
    lines.some((line) => line.startsWith("load stayed at or above 6 for 1s")),
  ).toBe(true);
  expect(existsSync(join(origin.base, "state/gate/holder.json"))).toBe(false);
});

it("does not wait when the load is already below max_load", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const { code, reads, lines } = run(origin, [2], 60);
  expect(code).toBe(0);
  expect(reads).toEqual([2]);
  expect(lines.some((line) => line.startsWith("waiting for load"))).toBe(false);
});

it("reads max_load as a positive number", () => {
  expect(readGate("pmcp.toml", "/p", { max_load: 6 }).maxLoad).toBe(6);
  expect(readGate("pmcp.toml", "/p", {}).maxLoad).toBeUndefined();
  expect(() => readGate("pmcp.toml", "/p", { max_load: 0 })).toThrow(
    "a positive number",
  );
});
