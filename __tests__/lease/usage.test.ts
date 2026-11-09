import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireLease } from "../../src/lease/acquire.js";
import { admissible, readQueue } from "../../src/lease/admit.js";
import { leaseHeld, leasePaths } from "../../src/lease/files.js";
import { leaseStatus } from "../../src/lease/status.js";
import {
  appendUsage,
  packageDir,
  readUsage,
  signature,
  usageStats,
  type Usage,
} from "../../src/lease/usage.js";
import {
  leaseToml,
  pmcpSync,
  project,
  scratch,
  settings,
  shellHolder,
  until,
} from "./fixture.js";
import { operatorToken } from "../operator-token.js";

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function usage(over: Partial<Usage>): Usage {
  return {
    at: "2026-11-04T00:00:00Z",
    signature: "npm test",
    dir: ".",
    lane: "interactive",
    weight: 2,
    start: "queue",
    outcome: "ran",
    exit: 0,
    wall_s: 10,
    user_s: 1,
    sys_s: 1,
    max_rss_kb: 1024,
    read_bytes: 0,
    write_bytes: 0,
    source: "proc",
    ...over,
  };
}

describe("usage records", () => {
  it("keep a command's signature and package directory, never its values", () => {
    expect(signature(["bun", "run", "test", "--filter", "x"])).toBe(
      "bun run test",
    );
    expect(
      signature(["/usr/bin/node", "scripts/build.mjs", "--out=dist"]),
    ).toBe("node");
    expect(signature(["npm", "install", "left-pad@1.3.0", "secret"])).toBe(
      "npm install",
    );
    expect(signature(["make", "TOKEN=abc", "all"])).toBe("make");
    expect(signature(["cargo", "build", "--release"])).toBe("cargo build");
    expect(packageDir("/repo/apps/web", "/repo")).toBe("apps/web");
    expect(packageDir("/repo", "/repo")).toBe(".");
    expect(packageDir("/tmp/x", "/repo")).toBe("(outside)");
  });

  it("are written for a success, a failure, a timeout and a bypass", () => {
    const { base, dir, env: agent } = scratch();
    const operator = operatorToken(base);
    const env = { ...agent, ...operator.env };
    const cwd = project(
      base,
      `${leaseToml(dir, "max_wait = 1\n")}${operator.toml}`,
    );
    expect(pmcpSync(["heavy", "--", "true"], cwd, env).status).toBe(0);
    expect(
      pmcpSync(["heavy", "--", "sh", "-c", "exit 3"], cwd, env).status,
    ).toBe(3);
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    expect(pmcpSync(["heavy", "--", "true"], cwd, env).status).toBe(75);
    const now = ["heavy", "--now", "--reason", "fix prod", "--", "true"];
    expect(pmcpSync(now, cwd, env).status).toBe(0);
    const records = readUsage(join(dir, "usage.jsonl"));
    expect(
      records.map((r) => [r.signature, r.outcome, r.exit, r.start, r.dir]),
    ).toEqual([
      ["true", "ran", 0, "queue", "."],
      ["sh", "ran", 3, "queue", "."],
      ["true", "timeout", 75, "none", "."],
      ["true", "ran", 0, "bypass", "."],
    ]);
    expect(records[0]!.source).toBe("proc");
    expect(records[0]!.wall_s).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("are listed by stats, the most-run first, cut to --top", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "usage.jsonl");
    for (const [name, runs] of [
      ["npm test", 3],
      ["npm run build", 2],
      ["cargo build", 1],
    ] as const)
      for (let at = 0; at < runs; at += 1)
        appendUsage(file, usage({ signature: name }), 1_000_000);
    const json = pmcpSync(["heavy", "stats", "--top", "2", "--json"], cwd, env);
    expect(json.status).toBe(0);
    expect(
      (JSON.parse(json.stdout) as { data: { signature: string }[] }).data.map(
        (stat) => stat.signature,
      ),
    ).toEqual(["npm test @ .", "npm run build @ ."]);
    const text = pmcpSync(["heavy", "stats", "--top", "1"], cwd, env);
    expect(text.stdout).toContain("npm test @ .");
    expect(text.stdout).not.toContain("npm run build");
    expect(pmcpSync(["heavy", "stats", "--top", "0"], cwd, env).status).toBe(2);
  }, 30_000);

  it("rotate to usage.jsonl.1 at the size cap and read both", () => {
    const { dir } = scratch();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "usage.jsonl");
    for (let at = 0; at < 5; at += 1)
      appendUsage(file, usage({ wall_s: at }), 300);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(readUsage(file).length).toBeLessThan(5);
    expect(readUsage(file).at(-1)!.wall_s).toBe(4);
  });

  it("aggregate to samples and p50/p90 per signature and directory", () => {
    const records = [
      ...Array.from({ length: 10 }, (_, at) => usage({ wall_s: at + 1 })),
      usage({ exit: 1, wall_s: 100 }),
      usage({ outcome: "timeout", exit: 75, wall_s: 0 }),
      usage({ signature: "npm install", dir: "apps/web", wall_s: 60 }),
    ];
    const [test, install] = usageStats(records);
    expect(test).toMatchObject({
      signature: "npm test @ .",
      samples: 11,
      failed: 1,
      timeouts: 1,
    });
    expect(test!.p50.wall_s).toBe(6);
    expect(test!.p90.wall_s).toBe(10);
    expect(install).toMatchObject({
      signature: "npm install @ apps/web",
      samples: 1,
    });
  });
});

describe("pmcp heavy --now", () => {
  it("runs at once with the budget full, counts its weight, and shows in status and the log", () => {
    const { dir, env } = scratch();
    const full = spawn("sleep", ["30"], { stdio: "ignore" });
    children.push(full);
    mkdirSync(join(dir, "running"), { recursive: true });
    writeFileSync(
      join(dir, "running", String(full.pid)),
      `pid=${full.pid}\nsince=1\nstarted=x\ncwd=/c\nlabel=big\nlane=bulk\nweight=4\n`,
    );
    const outcome = acquireLease({
      settings: settings(dir),
      profile: "default",
      label: "hotfix",
      cwd: "/w",
      env,
      say: () => {},
      lane: "gate",
      weight: 1,
      now: "prod is down",
    });
    expect(outcome).toMatchObject({ kind: "held", start: "bypass" });
    const { running } = readQueue(leasePaths(dir));
    expect(running.map((job) => job.weight).sort()).toEqual([1, 4]);
    const gate = { ...running[0]!, pid: 1, lane: "gate" as const, weight: 1 };
    expect(admissible(settings(dir), running, [gate]).size).toBe(0);
    const lines = leaseStatus({
      settings: settings(dir),
      env,
      outside: () => [],
    });
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^bypass running: pid ${process.pid}, reason prod is down, since \\d+s$`,
          "u",
        ),
      ),
    );
    expect(readFileSync(join(dir, "heavy.log"), "utf8")).toMatch(
      /\tbypass\treason=prod is down cwd=\/w label=hotfix lane=gate weight=1\n/u,
    );
    if (outcome.kind === "held") outcome.release(0, 0);
  });

  it("refuses without a reason, takes one from PMCP_HEAVY_NOW, and never exits 75", () => {
    const { base, dir, env: agent } = scratch();
    const operator = operatorToken(base);
    const env = { ...agent, ...operator.env };
    const cwd = project(
      base,
      `${leaseToml(dir, "max_wait = 1\n")}${operator.toml}`,
    );
    const refused = pmcpSync(
      ["heavy", "--now", "--reason", "x", "--", "true"],
      cwd,
      { ...agent, CLAUDE_CODE_SESSION_ID: "agent" },
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(
      "pmcp heavy --now is the operator's to run",
    );
    expect(refused.stderr).toContain("Ask the operator");
    expect(pmcpSync(["heavy", "--now", "--", "true"], cwd, env).status).toBe(2);
    expect(
      pmcpSync(["heavy", "--reason", "x", "--", "true"], cwd, env).status,
    ).toBe(2);
    children.push(shellHolder(dir, 30));
    until(() => leaseHeld(leasePaths(dir)));
    const now = pmcpSync(["heavy", "--", "true"], cwd, {
      ...env,
      PMCP_HEAVY_NOW: "release blocker",
    });
    expect(now.status).toBe(0);
    expect(now.stderr).toContain("BYPASS: running now");
  }, 30_000);
});
