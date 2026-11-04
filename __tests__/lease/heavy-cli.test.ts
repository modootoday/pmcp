import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { leaseHeld, leasePaths } from "../../src/lease/files.js";
import {
  finished,
  leaseToml,
  pmcp,
  pmcpSync,
  project,
  scratch,
  shellHolder,
  until,
} from "./fixture.js";

const holders: ChildProcess[] = [];
afterEach(() => {
  for (const child of holders.splice(0)) child.kill();
});

function job(trace: string, name: string): string[] {
  return [
    "sh",
    "-c",
    `echo start ${name} >> ${trace}; sleep 1; echo end ${name} >> ${trace}`,
  ];
}

describe("pmcp heavy", () => {
  it("serialises two leased commands across processes", async () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    const trace = join(base, "trace");
    const first = pmcp(
      ["heavy", "--label", "a", "--", ...job(trace, "a")],
      cwd,
      env,
    );
    until(() => existsSync(trace));
    const second = pmcp(
      ["heavy", "--label", "b", "--", ...job(trace, "b")],
      cwd,
      env,
    );
    const results = await Promise.all([finished(first), finished(second)]);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    expect(readFileSync(trace, "utf8").trim().split("\n")).toEqual([
      "start a",
      "end a",
      "start b",
      "end b",
    ]);
    expect(results[1]!.stderr).toContain(
      "pmcp heavy: waiting for host lease held by pid",
    );
    const events = readFileSync(join(dir, "heavy.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("\t")[2]);
    expect(events).toEqual(["acquired", "released", "acquired", "released"]);
  }, 30_000);

  it("exits 75 with nothing run when the lease stays held past max_wait", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, "max_wait = 1\n"));
    holders.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const ran = join(base, "ran");
    const run = pmcpSync(["heavy", "--", "touch", ran], cwd, env);
    expect(run.status).toBe(75);
    expect(run.stderr).toContain("not run: host busy");
    expect(existsSync(ran)).toBe(false);
  }, 30_000);

  it("runs at once with the lease disabled in config or by PMCP_HEAVY_DISABLE", () => {
    const { base, dir, env } = scratch();
    const off = project(
      base,
      `[host.lease]\nenabled = false\ndir = "${dir}"\n`,
    );
    const disabled = pmcpSync(["heavy", "--", "sh", "-c", "exit 4"], off, env);
    expect(disabled.status).toBe(4);
    expect(disabled.stderr).toContain("lease disabled");
    expect(existsSync(dir)).toBe(false);
    const on = project(join(base, "on"), leaseToml(dir, "max_wait = 1\n"));
    holders.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const skipped = pmcpSync(["heavy", "--", "true"], on, {
      ...env,
      PMCP_HEAVY_DISABLE: "fixture",
    });
    expect(skipped.status).toBe(0);
    expect(readFileSync(join(dir, "heavy.log"), "utf8")).toContain(
      "\tskip\treason=fixture cwd=",
    );
  }, 30_000);

  it("passes the command its own options and the lease marker", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    const file = join(base, "words");
    writeFileSync(file, "alpha\n");
    expect(
      pmcpSync(["heavy", "--", "grep", "-q", "alpha", file], cwd, env).status,
    ).toBe(0);
    expect(
      pmcpSync(["heavy", "--", "grep", "-q", "beta", file], cwd, env).status,
    ).toBe(1);
    const marker = pmcpSync(
      ["heavy", "--", "sh", "-c", 'test "$PMCP_HEAVY_LEASE" -gt 0'],
      cwd,
      env,
    );
    expect(marker.status).toBe(0);
  }, 30_000);

  it("prints status and refuses a command without --", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    const status = pmcpSync(["heavy", "status"], cwd, env);
    expect(status.status).toBe(0);
    expect(status.stdout.split("\n").slice(0, 4)).toEqual([
      `lease: ${join(dir, "heavy.lock")}`,
      "host: load1 0.10 (max 1000), io some avg10 0.00 (max 1000)",
      "settled: now",
      "holder: none",
    ]);
    expect(pmcpSync(["heavy", "true"], cwd, env).status).toBe(2);
    expect(
      pmcpSync(["heavy", "--profile", "nope", "--", "true"], cwd, env).status,
    ).toBe(2);
  }, 30_000);
});
