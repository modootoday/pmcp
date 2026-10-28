import {
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { gate as readGate } from "../../src/git/config/tables.js";
import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
  type DeliverReceipt,
} from "../../src/git/mainline/deliver.js";
import { gateLog } from "../../src/git/mainline/gate.js";
import {
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

function run(origin: Remote, command: string[], logKeep?: number) {
  const receipts: DeliverReceipt[] = [];
  const report = recorder();
  const options: DeliverOptions = {
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 1,
      refuseDirectPush: true,
      duringPause: "refuse",
      gate: "command",
      pushEnv: {},
      leaseWaitSeconds: 1,
    },
    gate: {
      command,
      lockWaitSeconds: 60,
      ...(logKeep ? { logKeep } : {}),
    },
    tree: join(origin.base, "state/gate/tree"),
    logDir: join(origin.base, "state/gate-logs"),
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

const latest = (logs: string) =>
  join(logs, readFileSync(join(logs, "latest"), "utf8").trim());

describe("gate logs", () => {
  it("keep the full output under the tip's directory and name both in the receipt", () => {
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
    const tip = sh(origin.bare, "rev-parse", "main");
    expect(receipt.delivered).toBe(tip);
    const { log, logs } = receipt.gate!;
    expect(logs).toBe(join(origin.base, "state/gate-logs", tip));
    expect(dirname(log!)).toBe(logs);
    expect(latest(logs!)).toBe(log);
    expect(readFileSync(log!, "utf8")).toContain("stage one\nstage two\n");
    expect(lines.some((line) => line.endsWith(`gate log: ${log}`))).toBe(true);
    expect("reason" in receipt).toBe(false);
  });

  it("name the log of a failing gate too, with the reason", () => {
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
    expect(receipt.gate!.logs).toBe(
      join(origin.base, "state/gate-logs", receipt.replayed!),
    );
    expect(receipt.reason).toBe("the gate failed; nothing was pushed");
    expect(lines).toContain(
      `the gate failed (exit 3); full gate log: ${receipt.gate!.log}`,
    );
    expect(readFileSync(receipt.gate!.log!, "utf8")).toContain("broke");
  });

  it("keep every run of a tip, latest naming the newest", () => {
    const dir = join(remote().base, "gate-logs");
    const tip = "a".repeat(40);
    const first = gateLog(dir, tip);
    writeFileSync(first.log, "first run\n");
    const second = gateLog(dir, tip);
    writeFileSync(second.log, "second run\n");
    expect(second.logs).toBe(first.logs);
    expect(
      readdirSync(first.logs).filter((name) => name.endsWith(".log")),
    ).toHaveLength(2);
    expect(basename(second.log)).toMatch(/-2\.log$/u);
    expect(latest(first.logs)).toBe(second.log);
    expect(readFileSync(first.log, "utf8")).toBe("first run\n");
  });

  it("keep the newest log_keep tips, every run of a kept tip included", () => {
    const origin = remote();
    const dir = join(origin.base, "state/gate-logs");
    // Three earlier tips, oldest first; the newest of them has two runs.
    const old = ["1", "2", "3"].map((digit, at) => {
      const tip = join(dir, digit.repeat(40));
      mkdirSync(tip, { recursive: true });
      writeFileSync(join(tip, "2026-01-01T00-00-00-000Z-1.log"), "");
      if (at === 2)
        writeFileSync(join(tip, "2026-01-01T00-00-01-000Z-2.log"), "");
      utimesSync(tip, 1_000 + at, 1_000 + at);
      return digit.repeat(40);
    });
    commit(origin.main, "a.txt", "a\n", "add a");
    const { receipt } = run(origin, ["true"], 2);
    expect(readdirSync(dir).sort()).toEqual(
      [old[2]!, basename(receipt.gate!.logs!)].sort(),
    );
    expect(readdirSync(join(dir, old[2]!))).toHaveLength(2);
  });

  it("read log_dir and log_keep like the other gate settings", () => {
    expect(
      readGate("pmcp.toml", "/proj", { log_dir: "/var/log/gate" }).logDir,
    ).toBe("/var/log/gate");
    expect(readGate("pmcp.toml", "/proj", { log_keep: 5 }).logKeep).toBe(5);
    expect(() => readGate("pmcp.toml", "/proj", { log_keep: 0 })).toThrow(
      "log_keep",
    );
  });

  it("live in the state dir when the gate tree is elsewhere", async () => {
    const origin = remote();
    const state = join(origin.base, "state");
    const tree = join(origin.base, "elsewhere/gate/tree");
    writeFileSync(
      join(origin.main, "pmcp.toml"),
      `[sessions]\nstate_dir = "${state}"\n[git]\n[git.mainline.gate]\ncommand = ["true"]\ntree = "${tree}"\n[git.mainline.deliver]\nattempts = 1\n`,
    );
    commit(origin.main, "a.txt", "a\n", "add a");
    let out = "";
    const ui = new Ui({
      env: {},
      quiet: true,
      stdout: { write: (text) => void (out += text) },
      stderr: { write: () => {} },
    });
    expect(
      await dispatch(["git", "deliver", "--json"], {
        cwd: origin.main,
        ui,
        env: process.env,
      }),
    ).toBe(0);
    const receipt = JSON.parse(out) as DeliverReceipt;
    expect(receipt.gate!.logs).toBe(
      join(state, "gate-logs", receipt.replayed!),
    );
  });
});
