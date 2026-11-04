import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { acquireLease } from "../../src/lease/acquire.js";
import { readHost } from "../../src/lease/host.js";
import { hostVerdict } from "../../src/lease/settle.js";
import {
  finished,
  leaseToml,
  pmcp,
  project,
  scratch,
  settings,
  until,
} from "./fixture.js";

// Measured 2026-11-04: a deploy's own boot IO held io avg10 near 60 after it released, and
// the queue stalled behind a signal no leased job caused. These replay that series.
const pressure = (avg10: number, avg60: number) =>
  `some avg10=${avg10} avg60=${avg60} avg300=1 total=0\nfull avg10=0 avg60=0 avg300=0 total=0\n`;

function reading(avg10: number, avg60: number, load = 1) {
  const { base } = scratch();
  writeFileSync(join(base, "p"), pressure(avg10, avg60));
  writeFileSync(join(base, "l"), `${load} 1 1 1/1 1\n`);
  return readHost({ loadavg: join(base, "l"), pressure: join(base, "p") });
}

describe("the host check", () => {
  const lease = settings("/x", { max_io: 8, max_load: 8, settle_window: 60 });
  const waiting = {
    lane: "interactive",
    weight: 2,
    grace: 900,
    waited: 10,
    sinceRelease: null,
    runningWeight: 2,
  };

  it("reads the smoothed io average, so a spike alone does not stall the queue", () => {
    expect(hostVerdict(lease, reading(60, 4), waiting)).toBe("settled");
    expect(
      hostVerdict(
        settings("/x", { max_io: 8, io_window: "avg10" }),
        reading(60, 4),
        waiting,
      ),
    ).toBe("severe");
  });

  it("starts hook work on a moderately busy host, never on a severe one", () => {
    const hook = { ...waiting, lane: "hook" };
    expect(hostVerdict(lease, reading(10, 10), hook)).toBe("hook");
    expect(hostVerdict(lease, reading(30, 30), hook)).toBe("severe");
  });

  it("starts a tiny job (weight 0) on a moderately busy host, never on a severe one", () => {
    const tiny = { ...waiting, weight: 0 };
    expect(hostVerdict(lease, reading(12, 12), tiny)).toBe("tiny");
    expect(hostVerdict(lease, reading(30, 30), tiny)).toBe("severe");
  });

  it("moves on settle_window after a release, below the hard ceiling only", () => {
    const after = (sinceRelease: number | null) => ({
      ...waiting,
      sinceRelease,
    });
    expect(hostVerdict(lease, reading(12, 12), after(null))).toBe("wait");
    expect(hostVerdict(lease, reading(12, 12), after(30))).toBe("wait");
    expect(hostVerdict(lease, reading(12, 12), after(60))).toBe("settle");
    expect(hostVerdict(lease, reading(20, 20), after(600))).toBe("severe");
    const off = settings("/x", { max_io: 8, settle_window: 0 });
    expect(hostVerdict(off, reading(12, 12), after(600))).toBe("wait");
  });

  it("replays a release followed by lingering IO: the waiter starts after the window", async () => {
    const { base, dir, env } = scratch();
    const cwd = project(
      base,
      `[host.lease]\ndir = "${dir}"\nmax_load = 1000\nmax_io = 8\nload_grace = 0\nsettle_window = 2\nbudget = 2\nheartbeat = 1\nper_session = 0\n`,
    );
    const holder = acquireLease({
      settings: settings(dir, { max_io: 8, budget: 2 }),
      profile: "default",
      label: "deploy",
      cwd,
      env,
      say: () => {},
    });
    if (holder.kind !== "held") throw new Error(holder.kind);
    writeFileSync(join(base, "pressure"), pressure(60, 12));
    const trace = join(base, "trace");
    const waiter = pmcp(
      ["heavy", "--", "sh", "-c", `date +%s > ${trace}`],
      cwd,
      env,
    );
    const done = finished(waiter);
    until(
      () =>
        existsSync(join(dir, "waiters")) &&
        readdirSync(join(dir, "waiters")).length > 0,
      10_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const released = Math.floor(Date.now() / 1000);
    holder.release(0, 5);
    const result = await done;
    expect(result.code).toBe(0);
    const started = Number(readFileSync(trace, "utf8").trim());
    expect(started - released).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(dir, "heavy.log"), "utf8")).toMatch(
      /\tsettle\twaited=\d+ load 0\.10 io 60 label=sh -c date/u,
    );
  }, 30_000);
});
