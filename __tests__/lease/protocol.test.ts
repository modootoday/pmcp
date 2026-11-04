import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireLease, type AcquireOptions } from "../../src/lease/acquire.js";
import { leaseHeld, leasePaths } from "../../src/lease/files.js";
import { leaseStatus } from "../../src/lease/status.js";
import type { ChildProcess } from "node:child_process";
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
  it("writes acquired and released log lines in the shell wrapper's format", () => {
    const { dir, env } = scratch();
    const outcome = acquireLease(options(dir, env));
    expect(outcome.kind).toBe("held");
    if (outcome.kind !== "held") return;
    const holder = readFileSync(join(dir, "heavy.holder"), "utf8");
    expect(holder).toMatch(
      new RegExp(
        `^pid=${process.pid}\nsince=\\d+\nstarted=${STAMP}\ncwd=/work/here\nlabel=unit job\n$`,
        "u",
      ),
    );
    expect(outcome.env).toEqual({ PMCP_HEAVY_LEASE: String(process.pid) });
    outcome.release(0, 3);
    expect(existsSync(join(dir, "heavy.holder"))).toBe(false);
    const [acquired, released] = logLines(dir);
    expect(acquired).toMatch(
      new RegExp(
        `^${STAMP}\t${process.pid}\tacquired\twaited=\\d+ cwd=/work/here label=unit job$`,
        "u",
      ),
    );
    expect(released).toMatch(
      new RegExp(`^${STAMP}\t${process.pid}\treleased\tran=3 rc=0$`, "u"),
    );
  });

  it("gives up at max_wait behind a shell holder and logs the timeout", () => {
    const { dir, env } = scratch();
    hold(dir);
    const outcome = acquireLease(options(dir, env, { max_wait: 1 }));
    expect(outcome).toMatchObject({ kind: "busy", waited: 1 });
    expect(outcome.kind === "busy" && outcome.holder).toMatch(
      /^pid \d+ shell job \(cwd \/somewhere, \d+s\)$/u,
    );
    expect(logLines(dir).at(-1)).toMatch(
      new RegExp(
        `^${STAMP}\t${process.pid}\ttimeout\twaited=1 label=unit job$`,
        "u",
      ),
    );
    expect(existsSync(join(dir, "waiters", String(process.pid)))).toBe(false);
  });

  it("runs at once for a marker naming the live holder, the legacy marker too", () => {
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

  it("hands both markers to the command when a legacy marker is configured", () => {
    const { dir, env } = scratch();
    const outcome = acquireLease(
      options(dir, env, { legacy_marker_env: "OLD_HEAVY_LEASE" }),
    );
    if (outcome.kind !== "held") throw new Error(outcome.kind);
    expect(outcome.env).toEqual({
      PMCP_HEAVY_LEASE: String(process.pid),
      OLD_HEAVY_LEASE: String(process.pid),
    });
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

  it("runs after load_grace on a busy host and logs the grace", () => {
    const { base, dir, env } = scratch();
    writeFileSync(join(base, "loadavg"), "99.00 1 1 1/1 1\n");
    const said: string[] = [];
    const outcome = acquireLease({
      ...options(dir, env, { max_load: 8, load_grace: 1 }, said),
    });
    if (outcome.kind !== "held") throw new Error(outcome.kind);
    outcome.release(0, 0);
    expect(said[0]).toBe(
      "holding the lease; waiting for load1 < 8 and io < 1000 (load 99.00 io 0.00)",
    );
    expect(logLines(dir)[1]).toMatch(
      new RegExp(
        `^${STAMP}\t${process.pid}\tgrace\twaited=1 load 99.00 io 0.00$`,
        "u",
      ),
    );
  });
});

describe("pmcp heavy status", () => {
  it("prints the shell wrapper's lines first, then hold and outside", () => {
    const { dir, env } = scratch();
    const holder = hold(dir);
    const since = Math.floor(Date.now() / 1000) - 50;
    writeFileSync(
      join(dir, "heavy.holder"),
      `pid=${holder.pid}\nsince=${since}\nstarted=x\ncwd=/somewhere\nlabel=shell job\n`,
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
        /^waiter: pid \d+ queued job \(cwd \/queue, 5\ds\)$/u,
      ),
      expect.stringMatching(
        new RegExp(
          `^hold: pid ${holder.pid} 5\\ds \\(warn 10s, max 40s\\) over-limit: over hold_max$`,
          "u",
        ),
      ),
      "outside: pid 7 cpu 93% io 1.3MB/s dockerd",
    ]);
    expect(existsSync(join(dir, "waiters", "999999999"))).toBe(false);
  });

  it("says none, never seen settled, and warns past hold_warn only", () => {
    const { base, dir, env } = scratch();
    writeFileSync(join(base, "loadavg"), "50.00 1 1 1/1 1\n");
    const idle = leaseStatus({
      settings: settings(dir, { max_load: 8 }),
      env,
      outside: () => [],
    });
    expect(idle.slice(1)).toEqual([
      "host: load1 50.00 (max 8), io some avg10 0.00 (max 1000)",
      "settled: last seen never",
      "holder: none",
      "waiters: none",
      "outside: none",
    ]);
    const holder = hold(dir);
    writeFileSync(
      join(dir, "heavy.holder"),
      `pid=${holder.pid}\nsince=${Math.floor(Date.now() / 1000) - 20}\nstarted=x\ncwd=/c\nlabel=j\n`,
    );
    const busy = leaseStatus({
      settings: settings(dir, { hold_warn: 10 }),
      env,
      outside: () => [],
    });
    expect(busy).toContainEqual(
      expect.stringMatching(
        /^hold: pid \d+ 2\ds \(warn 10s\) warning: over hold_warn$/u,
      ),
    );
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
