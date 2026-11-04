import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { promote, reprioritize } from "../../src/lease/control.js";
import { leaseHeld, leasePaths, liveRecords } from "../../src/lease/files.js";
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

// Queue control by id: the waiter record is the source of truth, rewritten under the admission
// lock and read by the waiting process on its next poll; every change is logged.
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

const who = { uid: 1000, session: "s-1" };

function idOf(dir: string, label: string): string {
  let id = "";
  until(() => {
    id =
      liveRecords(join(dir, "waiters"), false).find((r) => r.label === label)
        ?.id ?? "";
    return id !== "";
  }, 15_000);
  return id;
}

function fullBudget(dir: string): ChildProcess {
  const big = spawn("sleep", ["60"], { stdio: "ignore" });
  children.push(big);
  mkdirSync(join(dir, "running"), { recursive: true });
  writeFileSync(
    join(dir, "running", String(big.pid)),
    `pid=${big.pid}\nsince=1\nstarted=x\ncwd=/c\nlabel=big\nlane=bulk\nweight=4\n`,
  );
  return big;
}

describe("queue control", () => {
  it("promote starts a waiter at once with the budget full, logged with who and why", async () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    fullBudget(dir);
    const trace = join(base, "ran");
    const job = pmcp(
      ["heavy", "--label", "stuck", "--", "touch", trace],
      cwd,
      env,
    );
    children.push(job);
    const done = finished(job);
    const id = idOf(dir, "stuck");
    const listed = JSON.parse(
      pmcpSync(["heavy", "queue", "--json"], cwd, env).stdout,
    );
    expect(listed.waiters[0]).toMatchObject({
      id,
      lane: "interactive",
      position: 1,
    });
    expect(
      pmcpSync(["heavy", "promote", id, "--reason", "x"], cwd, env).status,
    ).toBe(2);
    const promoted = pmcpSync(
      ["heavy", "promote", id, "--now", "--reason", "release blocker"],
      cwd,
      env,
    );
    expect(promoted.status).toBe(0);
    expect((await done).code).toBe(0);
    expect(existsSync(trace)).toBe(true);
    const log = readFileSync(join(dir, "heavy.log"), "utf8");
    expect(log).toMatch(
      new RegExp(
        `\\tcontrol\\tid=${id} action=promote by=uid:\\d+ session=\\S+ reason=release blocker\\n`,
        "u",
      ),
    );
    expect(log).toMatch(
      new RegExp(`\\tbypass\\treason=release blocker .* id=${id}\\n`, "u"),
    );
  }, 30_000);

  it("priority reorders admission, and a lane change moves a waiter ahead", async () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, "budget = 1\n"));
    const holder = shellHolder(dir, 60);
    children.push(holder);
    until(() => leaseHeld(leasePaths(dir)));
    const trace = join(base, "trace");
    const runs = ["first", "second", "third"].map((name) => {
      const child = pmcp(
        [
          "heavy",
          "--label",
          name,
          "--",
          "sh",
          "-c",
          `echo ${name} >> ${trace}`,
        ],
        cwd,
        env,
      );
      children.push(child);
      idOf(dir, name);
      return finished(child);
    });
    const third = idOf(dir, "third");
    const second = idOf(dir, "second");
    expect(
      pmcpSync(
        ["heavy", "priority", third, "+2", "--reason", "blocks a land"],
        cwd,
        env,
      ).status,
    ).toBe(0);
    expect(
      pmcpSync(
        ["heavy", "priority", second, "sideways", "--reason", "x"],
        cwd,
        env,
      ).status,
    ).toBe(1);
    holder.kill();
    await Promise.all(runs);
    expect(readFileSync(trace, "utf8").trim().split("\n")).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect(readFileSync(join(dir, "heavy.log"), "utf8")).toMatch(
      new RegExp(
        `\\tcontrol\\tid=${third} action=priority \\+2 position=3->1 by=uid:\\d+`,
        "u",
      ),
    );
  }, 60_000);

  it("cancel takes a blocking run out of the queue; a dead waiter is reaped, not changed", async () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    fullBudget(dir);
    const job = pmcp(["heavy", "--label", "gone", "--", "true"], cwd, env);
    children.push(job);
    const done = finished(job);
    const id = idOf(dir, "gone");
    expect(
      pmcpSync(["heavy", "cancel", id, "--reason", "not needed"], cwd, env)
        .status,
    ).toBe(0);
    expect((await done).code).toBe(130);
    mkdirSync(join(dir, "waiters"), { recursive: true });
    writeFileSync(
      join(dir, "waiters", "999999999"),
      "pid=999999999\nsince=1\nstarted=x\ncwd=/q\nlabel=dead\nlane=bulk\nweight=1\nqueued=1\nsession=s\nid=1793000000-abcdef\n",
    );
    const paths = leasePaths(dir);
    expect(promote(paths, "1793000000-abcdef", who, "x")).toMatchObject({
      ok: false,
    });
    expect(existsSync(join(dir, "waiters", "999999999"))).toBe(false);
    expect(reprioritize(paths, "nope", "gate", who, "x")).toMatchObject({
      ok: false,
    });
  }, 30_000);
});
