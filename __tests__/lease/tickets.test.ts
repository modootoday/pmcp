import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { leaseHeld, leasePaths } from "../../src/lease/files.js";
import { STATUS_SCHEMA, statusJson } from "../../src/lease/status-json.js";
import { ticketView } from "../../src/lease/tickets.js";
import {
  leaseToml,
  pmcpSync,
  project,
  scratch,
  settings,
  shellHolder,
  until,
} from "./fixture.js";

// A caller that submits keeps working; the ticket queues and runs under the same rules,
// and outlives the process that submitted it.
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

describe("pmcp heavy submit", () => {
  it("returns a ticket at once while the budget is full, then runs it once there is room", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    const holder = shellHolder(dir, 60);
    children.push(holder);
    until(() => leaseHeld(leasePaths(dir)));
    const out = join(base, "ran");
    const begun = Date.now();
    const submitted = pmcpSync(
      [
        "heavy",
        "submit",
        "--label",
        "build",
        "--",
        "sh",
        "-c",
        `echo hi; touch ${out}; exit 4`,
      ],
      cwd,
      env,
    );
    expect(submitted.status).toBe(0);
    expect(Date.now() - begun).toBeLessThan(10_000);
    const ticket = submitted.stdout.trim();
    expect(ticket).toMatch(/^\d{10}-[0-9a-f]{6}$/u);
    // The submitter has exited; the ticket waits in the queue on its own.
    until(
      () =>
        ticketView(dir, ticket)?.state === "queued" &&
        ticketView(dir, ticket)?.position === 1,
      10_000,
    );
    const result = pmcpSync(["heavy", "result", ticket], cwd, env);
    expect(result.stdout).toMatch(
      new RegExp(`^${ticket} queued position 1 build`, "u"),
    );
    const snapshot = statusJson(settings(dir), env, () => []);
    expect(snapshot.waiters).toHaveLength(1);
    holder.kill();
    const waited = pmcpSync(
      ["heavy", "wait", ticket, "--timeout", "20"],
      cwd,
      env,
    );
    expect(waited.status).toBe(4);
    expect(waited.stderr).toContain("hi");
    expect(existsSync(out)).toBe(true);
    const json = JSON.parse(
      pmcpSync(["heavy", "result", ticket, "--json"], cwd, env).stdout,
    ).data;
    expect(json).toMatchObject({
      version: 1,
      id: ticket,
      state: "done",
      result: {
        ticket,
        exit: 4,
        outcome: "ran",
        signature: "sh",
        lane: "interactive",
        start: "queue",
      },
    });
    for (const key of [
      "wall_s",
      "user_s",
      "sys_s",
      "max_rss_kb",
      "read_bytes",
      "write_bytes",
    ])
      expect(typeof json.result[key]).toBe("number");
  }, 60_000);

  it("cancels a queued ticket, refuses a running one without --force, and times out a wait", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    const holder = shellHolder(dir, 60);
    children.push(holder);
    until(() => leaseHeld(leasePaths(dir)));
    const queued = pmcpSync(
      ["heavy", "submit", "--", "true"],
      cwd,
      env,
    ).stdout.trim();
    until(() => ticketView(dir, queued)?.position === 1, 10_000);
    expect(
      pmcpSync(["heavy", "wait", queued, "--timeout", "1"], cwd, env).status,
    ).toBe(75);
    expect(pmcpSync(["heavy", "cancel", queued], cwd, env).status).toBe(0);
    expect(ticketView(dir, queued)?.result).toMatchObject({
      outcome: "cancelled",
    });
    holder.kill();
    const flag = join(base, "started");
    const long = pmcpSync(
      ["heavy", "submit", "--", "sh", "-c", `touch ${flag}; sleep 30`],
      cwd,
      env,
    ).stdout.trim();
    until(() => existsSync(flag), 15_000);
    until(() => ticketView(dir, long)?.state === "running", 10_000);
    expect(pmcpSync(["heavy", "cancel", long], cwd, env).status).toBe(1);
    expect(
      pmcpSync(["heavy", "cancel", long, "--force"], cwd, env).status,
    ).toBe(0);
    expect(pmcpSync(["heavy", "result", "nope"], cwd, env).status).toBe(2);
  }, 60_000);
});

describe("pmcp heavy status --json", () => {
  it("has the pmcp.heavy.status.v1 shape and writes nothing", () => {
    const { dir, env } = scratch();
    const snapshot = statusJson(settings(dir), env, () => [
      { pid: 7, cpu: 50.4, ioMbps: 1.26, command: "dockerd" },
    ]);
    expect(Object.keys(snapshot)).toEqual([
      "version",
      "schema",
      "enabled",
      "dir",
      "budget",
      "running_weight",
      "legacy_holder",
      "host",
      "lanes",
      "waiters",
      "tickets",
      "grace_24h",
      "outside",
      "skip",
    ]);
    expect(snapshot).toMatchObject({
      version: 1,
      schema: STATUS_SCHEMA,
      enabled: true,
      budget: 4,
      running_weight: 0,
      host: { load1: 0.1, io_some_avg10: 0, io_window: "avg60", settled: true },
      lanes: [
        { lane: "gate", slots: 1, running: [] },
        { lane: "hook", slots: 1, running: [] },
        { lane: "interactive", slots: 2, running: [] },
        { lane: "bulk", slots: 1, running: [] },
      ],
      waiters: [],
      tickets: [],
      outside: [{ pid: 7, cpu_percent: 50, io_mbps: 1.3, command: "dockerd" }],
      skip: null,
    });
    expect(existsSync(dir)).toBe(false);
    const schemas = JSON.parse(
      readFileSync(
        new URL("../../docs/commands/schemas.json", import.meta.url),
        "utf8",
      ),
    ).schemas;
    expect(schemas["heavy-status"].required).toEqual(
      expect.arrayContaining(Object.keys(snapshot)),
    );
  });
});
