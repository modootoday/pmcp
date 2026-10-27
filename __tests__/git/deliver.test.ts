import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
} from "../../src/git/mainline/deliver.js";
import {
  filesSessionGate,
  type SessionGate,
} from "../../src/git/mainline/store.js";
import {
  clone,
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

function recordingStore(events: string[], paused = false): SessionGate {
  return {
    pause: {
      read: () =>
        paused
          ? {
              by: "operator",
              reason: "incident",
              since: "2026-10-19T00:00:00.000Z",
            }
          : null,
    },
    leases: {
      read: () => null,
      take: (name) => {
        events.push(`take:${name}`);
        return true;
      },
      release: (name) => {
        events.push(`release:${name}`);
      },
    },
  };
}

function options(
  origin: Remote,
  overrides: Partial<DeliverOptions> = {},
): DeliverOptions {
  return {
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 3,
      refuseDirectPush: true,
      duringPause: "refuse",
      gate: "command",
      pushEnv: {},
      leaseWaitSeconds: 3600,
    },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [{ name: "lockfile", paths: ["bun.lock"] }],
    store: recordingStore([]),
    report: recorder(),
    ...overrides,
  };
}

function originMain(origin: Remote): string {
  return sh(origin.bare, "rev-parse", "main");
}

it("replays the commits onto the upstream, gates them in the gate tree and fast-forwards the mainline", () => {
  const origin = remote();
  const before = originMain(origin);
  commit(origin.main, "a.txt", "a\n", "add a");
  const marks = join(origin.base, "gated");
  const gate = {
    command: ["sh", "-c", `git rev-parse HEAD >> ${marks}`],
    lockWaitSeconds: 60,
  };
  expect(deliver(options(origin, { gate }))).toBe(0);
  const tip = originMain(origin);
  expect(sh(origin.bare, "rev-parse", `${tip}^`)).toBe(before);
  expect(sh(origin.bare, "log", "-1", "--format=%s", tip)).toBe("add a");
  expect(readFileSync(marks, "utf8").trim()).toBe(tip);
  expect(existsSync(join(origin.base, "state/gate/tree/a.txt"))).toBe(true);
});

it("pushes nothing when the gate fails", () => {
  const origin = remote();
  const before = originMain(origin);
  commit(origin.main, "a.txt", "a\n", "add a");
  const gate = { command: ["sh", "-c", "exit 3"], lockWaitSeconds: 60 };
  expect(deliver(options(origin, { gate }))).toBe(1);
  expect(originMain(origin)).toBe(before);
});

it("replays again and retries when another clone pushes first", () => {
  const origin = remote();
  const other = clone(origin, "other");
  commit(origin.main, "a.txt", "a\n", "add a");
  const flag = join(origin.base, "raced");
  const race = `if [ ! -e ${flag} ]; then touch ${flag}; cd ${other} && git commit -q --allow-empty -m race && git push -q origin HEAD:main; fi`;
  const report = recorder();
  const gate = { command: ["sh", "-c", race], lockWaitSeconds: 60 };
  expect(deliver(options(origin, { gate, report }))).toBe(0);
  const tip = originMain(origin);
  expect(sh(origin.bare, "log", "-1", "--format=%s", tip)).toBe("add a");
  expect(sh(origin.bare, "log", "-1", "--format=%s", `${tip}^`)).toBe("race");
  expect(
    report.lines.some((line) => line.includes("moved while the gate ran")),
  ).toBe(true);
});

it("refuses to deliver while the sessions are paused", () => {
  const origin = remote();
  const before = originMain(origin);
  commit(origin.main, "a.txt", "a\n", "add a");
  const report = recorder();
  expect(
    deliver(options(origin, { store: recordingStore([], true), report })),
  ).toBe(1);
  expect(originMain(origin)).toBe(before);
  expect(report.lines.join("\n")).toMatch(/paused/u);
});

it("holds the lockfile lease through the push and the follow-up sync when the commits touch the lockfile", () => {
  const origin = remote();
  commit(origin.main, "bun.lock", "lock v2\n", "bump lock");
  const events: string[] = [];
  const code = deliver(
    options(origin, {
      store: recordingStore(events),
      afterDeliver: () => {
        events.push("after");
        return null;
      },
    }),
  );
  expect(code).toBe(0);
  expect(events).toEqual(["take:lockfile", "after", "release:lockfile"]);
});

it("takes no lease when the commits leave the lockfile alone", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const events: string[] = [];
  expect(deliver(options(origin, { store: recordingStore(events) }))).toBe(0);
  expect(events).toEqual([]);
});

function orphanSleep(seconds: number): number {
  const pid = execFileSync(
    "sh",
    ["-c", `sleep ${seconds} >/dev/null 2>&1 & echo $!`],
    { encoding: "utf8" },
  );
  return Number(pid.trim());
}

function heldLease(origin: Remote, pid: number): SessionGate {
  const store = filesSessionGate(join(origin.base, "state"));
  const lease = {
    pid,
    subject: "bump lock elsewhere",
    cwd: "/elsewhere",
    since: "2026-10-19T00:00:00.000Z",
  };
  expect(store.leases.take("lockfile", lease)).toBe(true);
  return store;
}

it("waits for another live session's lease and delivers once its holder is gone", () => {
  const origin = remote();
  commit(origin.main, "a.txt", "a\n", "add a");
  const store = heldLease(origin, orphanSleep(2));
  const report = recorder();
  const started = Date.now();
  const code = deliver(options(origin, { store, report, leasePollMs: 100 }));
  expect(code).toBe(0);
  expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
  expect(report.lines.join("\n")).toMatch(/waiting for lease lockfile/u);
  expect(sh(origin.bare, "log", "-1", "--format=%s", "main")).toBe("add a");
});

it("refuses after lease_wait_seconds and names the holder's subject and pid", () => {
  const origin = remote();
  const before = sh(origin.bare, "rev-parse", "main");
  commit(origin.main, "a.txt", "a\n", "add a");
  const pid = orphanSleep(30);
  try {
    const store = heldLease(origin, pid);
    const report = recorder();
    const settings = {
      attempts: 3,
      refuseDirectPush: true,
      duringPause: "refuse" as const,
      gate: "command" as const,
      pushEnv: {},
      leaseWaitSeconds: 1,
    };
    const code = deliver(
      options(origin, { store, report, deliver: settings, leasePollMs: 100 }),
    );
    expect(code).toBe(1);
    const said = report.lines.join("\n");
    expect(said).toMatch(/bump lock elsewhere/u);
    expect(said).toContain(`pid ${pid}`);
    expect(sh(origin.bare, "rev-parse", "main")).toBe(before);
  } finally {
    process.kill(pid);
  }
});
