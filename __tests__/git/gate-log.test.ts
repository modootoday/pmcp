import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { gate as readGate } from "../../src/git/config/tables.js";
import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
  type DeliverReceipt,
} from "../../src/git/mainline/deliver.js";
import {
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

function run(origin: Remote, command: string[]) {
  const receipts: DeliverReceipt[] = [];
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
    gate: { command, lockWaitSeconds: 60 },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    onReceipt: (receipt) => receipts.push(receipt),
    report,
  };
  const code = deliver(options);
  return { code, receipt: receipts[0]!, lines: report.lines };
}

it("keeps the gate's full output in a log it names, and returns a receipt", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const { code, receipt, lines } = run(origin, [
    "sh",
    "-c",
    "echo stage one; echo stage two >&2",
  ]);
  expect(code).toBe(0);
  expect(receipt).toMatchObject({
    ok: true,
    code: 0,
    upstream: "origin/main",
    attempts: 1,
    leases: [],
  });
  expect(receipt.delivered).toBe(sh(origin.bare, "rev-parse", "main"));
  expect(receipt.gate?.exit).toBe(0);
  const log = receipt.gate!.log!;
  expect(log.startsWith(join(origin.base, "state/gate/logs"))).toBe(true);
  expect(readFileSync(log, "utf8")).toContain("stage one\nstage two\n");
  expect(lines.some((line) => line.endsWith(`gate log: ${log}`))).toBe(true);
  expect("reason" in receipt).toBe(false);
});

it("names the log when the gate fails and gives the reason in the receipt", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const { code, receipt, lines } = run(origin, [
    "sh",
    "-c",
    "echo broke; exit 3",
  ]);
  expect(code).toBe(1);
  expect(receipt).toMatchObject({
    ok: false,
    code: 1,
    delivered: null,
    gate: { exit: 3 },
  });
  expect(receipt.reason).toBe("the gate failed; nothing was pushed");
  expect(lines).toContain(
    `the gate failed (exit 3); full gate log: ${receipt.gate!.log}`,
  );
  expect(readFileSync(receipt.gate!.log!, "utf8")).toContain("broke");
});

it("keeps the newest 20 gate logs", () => {
  const origin = remote();
  const logs = join(origin.base, "state/gate/logs");
  mkdirSync(logs, { recursive: true });
  for (let i = 0; i < 25; i++)
    writeFileSync(
      join(logs, `2026-01-01T00-00-${String(i).padStart(2, "0")}-000Z-old.log`),
      "",
    );
  commit(origin.main, "a.txt", "a\n", "add a");
  expect(run(origin, ["true"]).code).toBe(0);
  const left = readdirSync(logs);
  expect(left).toHaveLength(20);
  expect(left.some((name) => name.includes("-00-00-000Z-old"))).toBe(false);
});

it("reads log_dir like the other gate paths", () => {
  expect(
    readGate("pmcp.toml", "/proj", { log_dir: "/var/log/gate" }).logDir,
  ).toBe("/var/log/gate");
});
