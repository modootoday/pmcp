import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it } from "vitest";

import { gate as readGate } from "../../src/git/config/tables.js";
import { removeHolder } from "../../src/git/mainline/lock.js";
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

const holders: ChildProcess[] = [];
afterEach(() => {
  for (const child of holders.splice(0)) child.kill("SIGKILL");
  delete process.env["PMCP_TEST_GATE_LOCK"];
});

function options(
  origin: Remote,
  overrides: Partial<DeliverOptions> = {},
): DeliverOptions {
  return {
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 1,
      refuseDirectPush: true,
      duringPause: "refuse",
      leaseWaitSeconds: 1,
    },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    report: recorder(),
    ...overrides,
  };
}

// Another tool holding the gate lock the way a workspace land script does: flock on the file
// beside the gate tree, for as long as its process lives.
async function holdLock(origin: Remote): Promise<void> {
  const dir = join(origin.base, "state/gate");
  mkdirSync(dir, { recursive: true });
  const child = spawn("flock", [join(dir, "lock"), "-c", "sleep 30"], {
    stdio: "ignore",
  });
  holders.push(child);
  for (let i = 0; i < 50; i++) {
    await new Promise((done) => setTimeout(done, 50));
    if (existsSync(join(dir, "lock"))) break;
  }
  await new Promise((done) => setTimeout(done, 200));
}

it("waits on a gate lock another tool holds with flock, then gives up", async () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  await holdLock(origin);
  const report = recorder();
  const gate = { command: ["true"], lockWaitSeconds: 1 };
  expect(deliver(options(origin, { gate, report }))).toBe(1);
  expect(
    report.lines.some((line) => line.startsWith("waiting for the gate")),
  ).toBe(true);
  expect(report.lines).toContain("the gate lock stayed held for 1s");
});

it("sets lock_env for the gate and removes its holder record afterwards", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const seen = join(origin.base, "seen");
  const gate = {
    command: ["sh", "-c", `printf %s "$PMCP_TEST_GATE_LOCK" > ${seen}`],
    lockWaitSeconds: 60,
    lockEnv: "PMCP_TEST_GATE_LOCK",
  };
  expect(deliver(options(origin, { gate }))).toBe(0);
  expect(readFileSync(seen, "utf8")).toBe("1");
  expect(existsSync(join(origin.base, "state/gate/holder.json"))).toBe(false);
});

it("does not take the lock again when started under a holder that set lock_env", async () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  await holdLock(origin);
  process.env["PMCP_TEST_GATE_LOCK"] = "1";
  const report = recorder();
  const gate = {
    command: ["true"],
    lockWaitSeconds: 1,
    lockEnv: "PMCP_TEST_GATE_LOCK",
  };
  expect(deliver(options(origin, { gate, report }))).toBe(0);
  expect(report.lines).toContain(
    "the gate lock is held by the caller (PMCP_TEST_GATE_LOCK=1); not taking it again",
  );
});

it("accepts only an environment variable name as lock_env", () => {
  expect(
    readGate("pmcp.toml", "/p", { lock_env: "GATE_LOCK_HELD" }).lockEnv,
  ).toBe("GATE_LOCK_HELD");
  expect(() => readGate("pmcp.toml", "/p", { lock_env: "gate-lock" })).toThrow(
    "environment variable name",
  );
});

// The race itself (the next holder writing between our release and our cleanup) is too narrow
// to force here; what makes it harmless is that cleanup never removes a record not ours.
it("never removes a holder record written by another process", () => {
  const origin = remote();
  const gate = join(origin.base, "state/gate");
  mkdirSync(gate, { recursive: true });
  const lock = join(gate, "lock");
  const theirs = {
    tip: "t",
    subject: "queued",
    checkout: "x",
    pid: process.ppid,
    startedAt: "s",
  };
  writeFileSync(join(gate, "holder.json"), JSON.stringify(theirs));
  removeHolder(lock);
  expect(
    JSON.parse(readFileSync(join(gate, "holder.json"), "utf8")).subject,
  ).toBe("queued");
  writeFileSync(
    join(gate, "holder.json"),
    JSON.stringify({ ...theirs, pid: process.pid }),
  );
  removeHolder(lock);
  expect(existsSync(join(gate, "holder.json"))).toBe(false);
});

// Released, the lock may go at once to a tool queued on it, which writes its own holder; ours
// must be gone before that, and theirs must survive our cleanup.
it("removes its own holder before releasing the lock, never the next holder's", async () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const gate = join(origin.base, "state/gate");
  const waiter = join(origin.base, "waiter.mjs");
  writeFileSync(
    waiter,
    `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify({ tip: "next", subject: "queued", checkout: "x", pid: process.pid, startedAt: "t" }));
setTimeout(() => {}, 1500);
`,
  );
  const holder = join(gate, "holder.json");
  const command = [
    "sh",
    "-c",
    `flock ${join(gate, "lock")} ${process.execPath} ${waiter} ${holder} >/dev/null 2>&1 &`,
  ];
  expect(
    deliver(options(origin, { gate: { command, lockWaitSeconds: 60 } })),
  ).toBe(0);
  let record: { subject?: string } | null = null;
  for (let i = 0; i < 40 && record?.subject !== "queued"; i++) {
    await new Promise((done) => setTimeout(done, 50));
    record = existsSync(holder)
      ? (JSON.parse(readFileSync(holder, "utf8")) as { subject?: string })
      : null;
  }
  expect(record?.subject).toBe("queued");
  await new Promise((done) => setTimeout(done, 300));
  expect(existsSync(holder)).toBe(true);
});
