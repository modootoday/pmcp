import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireLease } from "../../src/lease/acquire.js";
import { admissible } from "../../src/lease/admit.js";
import {
  leaseHeld,
  leasePaths,
  type LeaseRecord,
} from "../../src/lease/files.js";
import {
  finished,
  leaseToml,
  pmcp,
  project,
  scratch,
  settings,
  shellHolder,
  until,
} from "./fixture.js";

// A land gate waited 2,024 s behind test and build jobs, one session queued half the jobs, and
// a grace once started a burst: lanes, a weight budget and a per-session cap answer those.
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function count(dir: string, sub: string): number {
  try {
    return readdirSync(join(dir, sub)).filter((n) => /^\d+$/u.test(n)).length;
  } catch {
    return 0;
  }
}

function record(dir: string, pid: number, lane: string, weight = 1): void {
  mkdirSync(join(dir, "waiters"), { recursive: true });
  const now = Date.now();
  writeFileSync(
    join(dir, "waiters", String(pid)),
    `pid=${pid}\nsince=${Math.floor(now / 1000)}\nstarted=x\ncwd=/q\nlabel=${lane} job\nlane=${lane}\nweight=${weight}\nqueued=${now}\nsession=other\n`,
  );
}

function job(pid: number, lane: string, weight: number): LeaseRecord {
  return {
    pid,
    since: 0,
    started: "",
    cwd: "",
    label: "",
    lane: lane as LeaseRecord["lane"],
    weight,
    queued: pid,
    session: "",
    bypass: "",
    grace: false,
    id: "",
    promote: "",
    cancel: "",
  };
}

describe("admission", () => {
  it("fills the budget by lane order and stops at the first job the budget cannot fit", () => {
    const lease = settings("/x");
    const waiters = [
      job(1, "gate", 1),
      job(2, "interactive", 2),
      job(3, "interactive", 2),
      job(4, "bulk", 3),
    ];
    expect([...admissible(lease, [], waiters)]).toEqual([1, 2]);
    expect([...admissible(lease, [job(9, "bulk", 3)], waiters)]).toEqual([1]);
    const full = [job(8, "interactive", 1), job(9, "interactive", 1)];
    expect([
      ...admissible(lease, full, [job(3, "interactive", 1), job(4, "bulk", 1)]),
    ]).toEqual([4]);
    const budgetFull = [job(9, "bulk", 4), job(8, "interactive", 0)];
    expect([
      ...admissible(lease, budgetFull, [
        job(5, "interactive", 2),
        job(6, "interactive", 0),
      ]),
    ]).toEqual([6]);
  });
});

describe("lease lanes", () => {
  it("hands a budget of one to gate, hook, interactive, then bulk, oldest first in each", async () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, "budget = 1\n"));
    const trace = join(base, "trace");
    const holder = shellHolder(dir, 60);
    children.push(holder);
    until(() => leaseHeld(leasePaths(dir)));
    const queue: [string, string[]][] = [
      ["b1", ["--lane", "bulk"]],
      ["i1", []],
      ["b2", ["--lane", "bulk"]],
      ["h1", ["--profile", "hook"]],
      ["i2", ["--lane", "interactive"]],
      ["g1", ["--profile", "gate"]],
    ];
    const runs = queue.map(([name, flags], at) => {
      const child = pmcp(
        ["heavy", ...flags, "--", "sh", "-c", `echo ${name} >> ${trace}`],
        cwd,
        env,
      );
      children.push(child);
      until(() => count(dir, "waiters") === at + 1, 15_000);
      return finished(child);
    });
    holder.kill();
    const results = await Promise.all(runs);
    expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(readFileSync(trace, "utf8").trim().split("\n")).toEqual([
      "g1",
      "h1",
      "i1",
      "i2",
      "b1",
      "b2",
    ]);
  }, 60_000);

  it("never runs more weight than the budget, with every job registered at once and a busy host", async () => {
    const { base, dir, env } = scratch();
    writeFileSync(
      join(base, "pressure"),
      "some avg10=50 avg60=50 avg300=50 total=0\n",
    );
    const cwd = project(
      base,
      `[host.lease]\ndir = "${dir}"\nmax_load = 1000\nmax_io = 8\nload_grace = 0\nbudget = 3\nheartbeat = 1\npoll = 1\nper_session = 0\n[host.lease.lanes]\ninteractive = 6\n`,
    );
    const trace = join(base, "trace");
    const weights = [1, 2, 1, 2, 1, 1];
    const runs = weights.map((weight, at) => {
      const child = pmcp(
        [
          "heavy",
          "--weight",
          String(weight),
          "--",
          "sh",
          "-c",
          `echo "+${weight}" >> ${trace}; sleep 0.5; echo "-${weight}" >> ${trace}`,
        ],
        cwd,
        { ...env, JOB: String(at) },
      );
      children.push(child);
      return finished(child);
    });
    until(() => count(dir, "waiters") === weights.length, 20_000);
    writeFileSync(
      join(base, "pressure"),
      "some avg10=0 avg60=0 avg300=0 total=0\n",
    );
    const results = await Promise.all(runs);
    expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0, 0, 0]);
    let weight = 0;
    let peak = 0;
    for (const line of readFileSync(trace, "utf8").trim().split("\n")) {
      weight += Number(line);
      peak = Math.max(peak, weight);
    }
    expect(weight).toBe(0);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  }, 60_000);

  it("ignores a dead waiter ahead and reports a bulk job held back by a live gate waiter", () => {
    const { dir, env } = scratch();
    record(dir, 999_999_999, "gate", 4);
    const base = {
      profile: "default",
      label: "bulk job",
      cwd: "/w",
      env,
      say: () => {},
    };
    const free = acquireLease({
      ...base,
      settings: settings(dir, { max_wait: 2 }),
      lane: "bulk",
      weight: 3,
    });
    expect(free.kind).toBe("held");
    if (free.kind === "held") free.release(0, 0);
    const gate = spawn("sleep", ["30"], { stdio: "ignore" });
    children.push(gate);
    record(dir, gate.pid!, "gate", 4);
    const said: string[] = [];
    const held = acquireLease({
      ...base,
      settings: settings(dir, { max_wait: 1 }),
      lane: "bulk",
      weight: 1,
      say: (line) => said.push(line),
    });
    expect(held).toMatchObject({
      kind: "busy",
      lane: "bulk",
      position: 2,
      reason: "queue",
    });
    expect(readFileSync(join(dir, "heavy.log"), "utf8").trim()).toMatch(
      /\ttimeout\twaited=1 label=bulk job lane=bulk position=2 reason=queue$/u,
    );
  });

  it("parks a session's second queued job in a lane outside the queue", () => {
    const { dir, env } = scratch();
    const mine = { ...env, CLAUDE_CODE_SESSION_ID: "session-a" };
    const other = spawn("sleep", ["30"], { stdio: "ignore" });
    children.push(other);
    mkdirSync(join(dir, "waiters"), { recursive: true });
    writeFileSync(
      join(dir, "waiters", String(other.pid)),
      `pid=${other.pid}\nsince=1\nstarted=x\ncwd=/q\nlabel=first\nlane=bulk\nweight=9\nqueued=1\nsession=session-a\n`,
    );
    const said: string[] = [];
    const base = {
      profile: "default",
      label: "second",
      cwd: "/w",
      say: (line: string) => said.push(line),
    };
    const parked = acquireLease({
      ...base,
      env: mine,
      settings: settings(dir, { per_session: 1, max_wait: 1 }),
      lane: "bulk",
    });
    expect(parked).toMatchObject({
      kind: "busy",
      reason: "parked",
      position: 0,
    });
    expect(said[0]).toBe(
      "parked outside the queue: this session already has 1 queued bulk job(s) (per_session 1)",
    );
    const hook = acquireLease({
      ...base,
      env: mine,
      settings: settings(dir, { per_session: 1 }),
      profile: "hook",
    });
    expect(hook.kind).toBe("held");
    if (hook.kind === "held") hook.release(0, 0);
  });
});
