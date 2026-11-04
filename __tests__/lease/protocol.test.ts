import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireLease, type AcquireOptions } from "../../src/lease/acquire.js";
import { leaseHeld, leasePaths } from "../../src/lease/files.js";
import { leaseStatus } from "../../src/lease/status.js";
import { scratch, settings, shellHolder, until } from "./fixture.js";

// The files are a protocol shared with shell wrappers: the log line and status shapes are
// pinned here, and pmcp only ever appends fields or lines after them.
const STAMP = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ`;
const holders: ChildProcess[] = [];
afterEach(() => {
  for (const child of holders.splice(0)) child.kill();
});

function options(
  dir: string,
  env: Record<string, string>,
  lease: Record<string, unknown> = {},
  said: string[] = [],
): AcquireOptions {
  return {
    settings: settings(dir, lease),
    profile: "default",
    label: "unit job",
    cwd: "/work/here",
    env,
    say: (line) => said.push(line),
  };
}

function logLines(dir: string): string[] {
  return readFileSync(join(dir, "heavy.log"), "utf8").trim().split("\n");
}

function hold(dir: string, seconds = 30): ChildProcess {
  const child = shellHolder(dir, seconds);
  holders.push(child);
  until(() => leaseHeld(leasePaths(dir)));
  return child;
}

describe("the lease files", () => {
  it("writes the shell wrapper's records and log lines, pmcp's fields appended", () => {
    const { dir, env } = scratch();
    const outcome = acquireLease(options(dir, env));
    expect(outcome.kind).toBe("held");
    if (outcome.kind !== "held") return;
    const record = new RegExp(
      `^pid=${process.pid}\nsince=\\d+\nstarted=${STAMP}\ncwd=/work/here\nlabel=unit job\nlane=interactive\nweight=2\nqueued=\\d+\nsession=\\S+\nid=\\d{10}-[0-9a-f]{6}\n$`,
      "u",
    );
    expect(readFileSync(join(dir, "heavy.holder"), "utf8")).toMatch(record);
    expect(
      readFileSync(join(dir, "running", String(process.pid)), "utf8"),
    ).toMatch(record);
    expect(leaseHeld(leasePaths(dir))).toBe(true);
    expect(outcome.env).toEqual({ PMCP_HEAVY_LEASE: String(process.pid) });
    outcome.release(0, 3);
    expect(existsSync(join(dir, "heavy.holder"))).toBe(false);
    expect(existsSync(join(dir, "running", String(process.pid)))).toBe(false);
    expect(leaseHeld(leasePaths(dir))).toBe(false);
    const [acquired, released] = logLines(dir);
    expect(acquired).toMatch(
      new RegExp(
        `^${STAMP}\t${process.pid}\tacquired\twaited=\\d+ cwd=/work/here label=unit job lane=interactive weight=2$`,
        "u",
      ),
    );
    expect(released).toMatch(
      new RegExp(`^${STAMP}\t${process.pid}\treleased\tran=3 rc=0$`, "u"),
    );
  });

  it("treats a shell wrapper's hold as the whole budget and logs the timeout", () => {
    const { dir, env } = scratch();
    hold(dir);
    const outcome = acquireLease(options(dir, env, { max_wait: 1 }));
    expect(outcome).toMatchObject({
      kind: "busy",
      reason: "legacy",
      lane: "interactive",
      position: 1,
    });
    expect(logLines(dir).at(-1)).toMatch(
      new RegExp(
        `^${STAMP}\t${process.pid}\ttimeout\twaited=1 label=unit job lane=interactive position=1 reason=legacy$`,
        "u",
      ),
    );
    expect(existsSync(join(dir, "waiters", String(process.pid)))).toBe(false);
  });

  it("runs at once for a marker naming a live holder, the legacy marker too", () => {
    const { dir, env } = scratch();
    const holder = hold(dir);
    const legacy = { legacy_marker_env: "OLD_HEAVY_LEASE", max_wait: 1 };
    const nested = { ...env, OLD_HEAVY_LEASE: String(holder.pid) };
    expect(acquireLease(options(dir, nested, legacy)).kind).toBe("reentrant");
    const own = { ...env, PMCP_HEAVY_LEASE: String(holder.pid) };
    expect(acquireLease(options(dir, own, legacy)).kind).toBe("reentrant");
    const stranger = { ...env, OLD_HEAVY_LEASE: "1" };
    expect(acquireLease(options(dir, stranger, legacy)).kind).toBe("busy");
  });

  it("hands the command both markers and the legacy skip, so a nested wrapper runs at once", () => {
    const { dir, env } = scratch();
    const outcome = acquireLease(
      options(dir, env, {
        legacy_marker_env: "OLD_HEAVY_LEASE",
        legacy_skip_env: "OLD_SKIP",
      }),
    );
    if (outcome.kind !== "held") throw new Error(outcome.kind);
    expect(outcome.env).toEqual({
      PMCP_HEAVY_LEASE: String(process.pid),
      OLD_HEAVY_LEASE: String(process.pid),
      OLD_SKIP: `inside pmcp heavy ${process.pid}`,
    });
    const nested = { ...env, PMCP_HEAVY_LEASE: String(process.pid) };
    expect(acquireLease(options(dir, nested)).kind).toBe("reentrant");
    outcome.release(0, 0);
  });

  it("skips the lease for PMCP_HEAVY_DISABLE or the legacy skip variable, logged with the reason", () => {
    const { dir, env } = scratch();
    hold(dir);
    const said: string[] = [];
    const skipped = acquireLease(
      options(dir, { ...env, PMCP_HEAVY_DISABLE: "unit test" }, {}, said),
    );
    expect(skipped).toEqual({ kind: "skipped", reason: "unit test" });
    expect(said).toEqual(["running without the host lease: unit test"]);
    expect(logLines(dir).at(-1)).toMatch(
      new RegExp(
        `^${STAMP}\t${process.pid}\tskip\treason=unit test cwd=/work/here label=unit job$`,
        "u",
      ),
    );
    const legacy = acquireLease(
      options(
        dir,
        { ...env, OLD_SKIP: "old" },
        { legacy_skip_env: "OLD_SKIP" },
      ),
    );
    expect(legacy).toEqual({ kind: "skipped", reason: "old" });
  });

  it("does nothing at all when the lease is disabled", () => {
    const { dir, env } = scratch();
    expect(acquireLease(options(dir, env, { enabled: false }))).toEqual({
      kind: "disabled",
    });
    expect(existsSync(dir)).toBe(false);
  });

  it("starts on load_grace into moderate overload and logs the load at start", () => {
    const { base, dir, env } = scratch();
    writeFileSync(join(base, "loadavg"), "10.00 1 1 1/1 1\n");
    const outcome = acquireLease(
      options(dir, env, { max_load: 8, load_grace: 1 }),
    );
    if (outcome.kind !== "held") throw new Error(outcome.kind);
    outcome.release(0, 0);
    expect(logLines(dir)[0]).toMatch(
      new RegExp(
        `^${STAMP}\t${process.pid}\tgrace\twaited=\\d+ load 10.00 io 0.00 label=unit job$`,
        "u",
      ),
    );
    const status = leaseStatus({
      settings: settings(dir),
      env,
      outside: () => [],
    });
    expect(status).toContainEqual(
      expect.stringMatching(
        /^grace: 1 job\(s\) started on load_grace in the last 24h, last \S+ \(waited=\d+ load 10\.00 io 0\.00 label=unit job\)$/u,
      ),
    );
  });

  it("never starts past the hard ceiling, nor without grace when load_grace is 0", () => {
    const { base, dir, env } = scratch();
    writeFileSync(join(base, "loadavg"), "17.00 1 1 1/1 1\n");
    const severe = acquireLease(
      options(dir, env, { max_load: 8, load_grace: 1, max_wait: 2 }),
    );
    expect(severe).toMatchObject({ kind: "busy", reason: "host" });
    writeFileSync(join(base, "loadavg"), "9.00 1 1 1/1 1\n");
    const noGrace = acquireLease(
      options(dir, env, { max_load: 8, load_grace: 0, max_wait: 2 }),
    );
    expect(noGrace).toMatchObject({ kind: "busy" });
    const harder = acquireLease(
      options(dir, env, { max_load: 8, hard_factor: 3, load_grace: 1 }),
    );
    expect(harder.kind).toBe("held");
    if (harder.kind === "held") harder.release(0, 0);
  }, 20_000);
});

describe("pmcp heavy status", () => {
  it("prints the shell wrapper's lines first, then lanes, running jobs, hold and outside", () => {
    const { dir, env } = scratch();
    const holder = hold(dir);
    const since = Math.floor(Date.now() / 1000) - 50;
    writeFileSync(
      join(dir, "heavy.holder"),
      `pid=${holder.pid}\nsince=${since}\nstarted=x\ncwd=/somewhere\nlabel=shell job\n`,
    );
    mkdirSync(join(dir, "running"), { recursive: true });
    writeFileSync(
      join(dir, "running", String(holder.pid)),
      `pid=${holder.pid}\nsince=${since}\nstarted=x\ncwd=/somewhere\nlabel=shell job\nlane=bulk\nweight=3\n`,
    );
    mkdirSync(join(dir, "waiters"), { recursive: true });
    writeFileSync(
      join(dir, "waiters", String(process.pid)),
      `pid=${process.pid}\nsince=${since}\nstarted=x\ncwd=/queue\nlabel=queued job\n`,
    );
    writeFileSync(join(dir, "waiters", "999999999"), "pid=999999999\n");
    const lines = leaseStatus({
      settings: settings(dir, { hold_warn: 10, hold_max: 40 }),
      env,
      outside: () => [{ pid: 7, cpu: 93.2, ioMbps: 1.25, command: "dockerd" }],
    });
    expect(lines).toEqual([
      `lease: ${join(dir, "heavy.lock")}`,
      "host: load1 0.10 (max 1000), io some avg10 0.00 (max 1000)",
      "settled: now",
      expect.stringMatching(
        new RegExp(
          `^holder: pid ${holder.pid} shell job \\(cwd /somewhere, 5\\ds\\)$`,
          "u",
        ),
      ),
      expect.stringMatching(
        /^waiter: pid \d+ queued job \(cwd \/queue, 5\ds\) lane interactive weight 1 position 1$/u,
      ),
      "lanes: gate 0/1 hook 0/1 interactive 0/2 bulk 1/1, weight 3/4",
      expect.stringMatching(
        /^running: pid \d+ shell job \(cwd \/somewhere, 5\ds\)$/u,
      ),
      expect.stringMatching(
        new RegExp(
          `^hold: pid ${holder.pid} 5\\ds \\(warn 10s, max 40s\\) over-limit: over hold_max lane bulk weight 3$`,
          "u",
        ),
      ),
      "io: the host check reads some avg60 0.00 (max 1000, hard 2000)",
      "grace: no job started on load_grace in the last 24h",
      "outside: pid 7 cpu 93% io 1.3MB/s dockerd",
    ]);
    expect(existsSync(join(dir, "waiters", "999999999"))).toBe(false);
  });

  it("says none when idle, and estimates waits from the log's run times", () => {
    const { dir, env } = scratch();
    const idle = leaseStatus({
      settings: settings(dir),
      env,
      outside: () => [],
    });
    expect(idle.slice(3, 6)).toEqual([
      "holder: none",
      "waiters: none",
      "lanes: gate 0/1 hook 0/1 interactive 0/2 bulk 0/1, weight 0/4",
    ]);
    writeFileSync(
      join(dir, "heavy.log"),
      [
        "2026-11-04T00:00:00Z\t11\tacquired\twaited=0 cwd=/c label=a lane=bulk weight=3",
        "2026-11-04T00:01:40Z\t11\treleased\tran=100 rc=0",
        "",
      ].join("\n"),
    );
    mkdirSync(join(dir, "waiters"), { recursive: true });
    for (const [pid, queued] of [
      [process.pid, 1],
      [process.ppid, 2],
    ] as const)
      writeFileSync(
        join(dir, "waiters", String(pid)),
        `pid=${pid}\nsince=1\nstarted=x\ncwd=/q\nlabel=w\nlane=bulk\nweight=4\nqueued=${queued}\n`,
      );
    const busy = leaseStatus({
      settings: settings(dir),
      env,
      outside: () => [],
    });
    expect(busy.filter((line) => line.startsWith("waiter:"))).toEqual([
      expect.stringMatching(/position 1 eta ~0s$/u),
      expect.stringMatching(/position 2 eta ~100s$/u),
    ]);
  });

  it("says disabled, and names this shell's skip reason", () => {
    const { dir, env } = scratch();
    expect(
      leaseStatus({ settings: settings(dir, { enabled: false }), env }),
    ).toEqual([
      "lease: disabled ([host.lease] enabled = false)",
      "host: load1 0.10 (max 1000), io some avg10 0.00 (max 1000)",
    ]);
    const skipped = leaseStatus({
      settings: settings(dir),
      env: { ...env, PMCP_HEAVY_DISABLE: "ci" },
      outside: () => [],
    });
    expect(skipped.at(-1)).toBe(
      "skip: this shell runs without the lease (PMCP_HEAVY_DISABLE): ci",
    );
  });
});
