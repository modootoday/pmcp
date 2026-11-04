import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { leaseHeld, leasePaths } from "../../src/lease/files.js";
import { readUsage, skipShare, usageStats } from "../../src/lease/usage.js";
import {
  CLI,
  leaseToml,
  pmcpSync,
  project,
  scratch,
  shellHolder,
  until,
} from "./fixture.js";

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

const BULK = 'commands = [{ argv = ["sleep"], lane = "bulk" }]\nmax_wait = 1\n';

describe("a bulk job nested in a leased job", () => {
  it("runs at once on the marker, even with a skip it would refuse", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, "budget = 1\nmax_wait = 1\n"));
    // The outer job holds the whole budget; a queued inner job would time out with 75.
    const inner = `PMCP_HEAVY_DISABLE=install bun ${CLI} heavy --lane bulk -- true`;
    const result = pmcpSync(
      ["heavy", "--weight", "1", "--", "sh", "-c", inner],
      cwd,
      env,
    );
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("not honoured");
  }, 30_000);
});

describe("the lease skip", () => {
  it("runs an ordinary command at once and records why it went around the lease", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, BULK));
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const result = pmcpSync(["heavy", "--", "true"], cwd, {
      ...env,
      PMCP_HEAVY_DISABLE: "probe",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("running without the host lease: probe");
    const records = readUsage(join(dir, "usage.jsonl"));
    expect(
      records.map((r) => [r.signature, r.outcome, r.skip, r.skip_env]),
    ).toEqual([["true", "ran", "probe", "PMCP_HEAVY_DISABLE"]]);
    expect(readFileSync(join(dir, "heavy.log"), "utf8")).toContain(
      "\tskip\treason=probe env=PMCP_HEAVY_DISABLE ",
    );
    expect(skipShare(records)).toEqual({ skipped: 1, runs: 1 });
    expect(usageStats(records)[0]!.skipped).toBe(1);
  }, 30_000);

  it("does not let a bulk command around the lease; it queues and says how to run now", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, BULK));
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const result = pmcpSync(["heavy", "--", "sleep", "0"], cwd, {
      ...env,
      PMCP_HEAVY_DISABLE: "whole suite",
    });
    // It queued behind the holder instead of running, and gave up at max_wait.
    expect(result.status).toBe(75);
    expect(result.stderr).toContain(
      "the lease skip (whole suite) is not honoured for a bulk job",
    );
    expect(result.stderr).toContain("pmcp heavy --now --reason");
    const records = readUsage(join(dir, "usage.jsonl"));
    expect(
      records.map((r) => [
        r.lane,
        r.outcome,
        r.skip,
        r.skip_refused,
        r.skip_env,
      ]),
    ).toEqual([
      ["bulk", "timeout", undefined, "whole suite", "PMCP_HEAVY_DISABLE"],
    ]);
    expect(readFileSync(join(dir, "heavy.log"), "utf8")).toContain(
      "\tskip-refused\treason=whole suite env=PMCP_HEAVY_DISABLE ",
    );
  }, 30_000);

  it("names the legacy skip variable when it carried a refused or an honoured skip", () => {
    const { base, dir, env } = scratch();
    const cwd = project(
      base,
      leaseToml(
        dir,
        `${BULK}legacy_skip_env = "OLD_SKIP"\nskip_always = ["gate-land"]\n`,
      ),
    );
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const refused = pmcpSync(["heavy", "--", "sleep", "0"], cwd, {
      ...env,
      OLD_SKIP: "old suite",
    });
    expect(refused.status).toBe(75);
    const honoured = pmcpSync(["heavy", "--", "true"], cwd, {
      ...env,
      OLD_SKIP: "gate-land",
    });
    expect(honoured.status).toBe(0);
    const records = readUsage(join(dir, "usage.jsonl"));
    expect(
      records.map((r) => [r.outcome, r.skip, r.skip_refused, r.skip_env]),
    ).toEqual([
      ["timeout", undefined, "old suite", "OLD_SKIP"],
      ["ran", "gate-land", undefined, "OLD_SKIP"],
    ]);
    const log = readFileSync(join(dir, "heavy.log"), "utf8");
    expect(log).toContain("\tskip-refused\treason=old suite env=OLD_SKIP ");
    expect(log).toContain("\tskip\treason=gate-land env=OLD_SKIP ");
  }, 30_000);

  it("does not let a job the caller put in the bulk lane around the lease either", () => {
    const { base, dir, env } = scratch();
    const cwd = project(
      base,
      leaseToml(dir, 'max_wait = 1\nskip_always = ["gate-land"]\n'),
    );
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const result = pmcpSync(["heavy", "--lane", "bulk", "--", "true"], cwd, {
      ...env,
      PMCP_HEAVY_DISABLE: "install",
    });
    expect(result.status).toBe(75);
    expect(result.stderr).toContain(
      "the lease skip (install) is not honoured for a bulk job (--lane bulk,",
    );
    const records = readUsage(join(dir, "usage.jsonl"));
    expect(records.map((r) => [r.lane, r.outcome, r.skip])).toEqual([
      ["bulk", "timeout", undefined],
    ]);
  }, 30_000);

  it("honours a skip_always reason even for a bulk job, as a normal skip", () => {
    const { base, dir, env } = scratch();
    const cwd = project(
      base,
      leaseToml(dir, 'max_wait = 1\nskip_always = ["gate-land"]\n'),
    );
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const result = pmcpSync(["heavy", "--lane", "bulk", "--", "true"], cwd, {
      ...env,
      PMCP_HEAVY_DISABLE: "gate-land",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "running without the host lease: gate-land",
    );
    expect(result.stderr).not.toContain("not honoured");
    const records = readUsage(join(dir, "usage.jsonl"));
    expect(records.map((r) => [r.lane, r.outcome, r.skip])).toEqual([
      ["bulk", "ran", "gate-land"],
    ]);
  }, 30_000);

  it("keeps enabled = false as the off switch, even for a bulk command", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, `${BULK}enabled = false\n`));
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const result = pmcpSync(["heavy", "--", "sleep", "0"], cwd, env);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("lease disabled");
  }, 30_000);
});
