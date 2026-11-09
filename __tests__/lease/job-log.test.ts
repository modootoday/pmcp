import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { JobLog, readJobLog } from "../../src/lease/job-log.js";
import { jobLogPath } from "../../src/lease/tickets.js";
import { leaseToml, pmcpSync, project, scratch } from "./fixture.js";

describe("a job's kept output", () => {
  it("rotates to log.1 past the cap and reads back with the rotated part first", () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-job-log-"));
    const path = join(dir, "log");
    const log = new JobLog(path, 12);
    log.write("one\ntwo\n");
    log.write("three\n");
    log.write("four\n");
    log.close();
    expect(readFileSync(`${path}.1`, "utf8")).toBe("one\ntwo\n");
    expect(readFileSync(path, "utf8")).toBe("three\nfour\n");
    expect(readJobLog(path)).toBe("one\ntwo\nthree\nfour\n");
    expect(readJobLog(path, 2)).toBe("three\nfour\n");
  });

  it("keeps a blocking run's stdout and stderr for heavy result --log", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir));
    const run = pmcpSync(
      ["heavy", "--", "sh", "-c", "echo out; echo err >&2; exit 3"],
      cwd,
      env,
    );
    expect(run.status).toBe(3);
    expect(run.stdout).toContain("out");
    expect(run.stderr).toContain("err");
    const id = /pmcp heavy result (\S+) --log/u.exec(run.stderr)?.[1] ?? "";
    expect(id).toMatch(/^\d{10}-[0-9a-f]{6}$/u);
    const kept = pmcpSync(["heavy", "result", id, "--log"], cwd, env);
    expect(kept.status).toBe(0);
    expect(kept.stdout).toContain("out\n");
    expect(kept.stdout).toContain("err\n");
    const tail = pmcpSync(
      ["heavy", "result", id, "--log", "--tail", "1"],
      cwd,
      env,
    );
    expect(tail.stdout.trim().split("\n")).toHaveLength(1);
    expect(
      pmcpSync(["heavy", "result", id, "--tail", "1"], cwd, env).status,
    ).toBe(2);
  }, 30_000);

  it("keeps nothing for a blocking run with job_log_bytes = 0", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, "job_log_bytes = 0\n"));
    const run = pmcpSync(["heavy", "--", "sh", "-c", "exit 5"], cwd, env);
    expect(run.status).toBe(5);
    expect(run.stderr).not.toContain("output kept");
    expect(existsSync(join(dir, "tickets"))).toBe(false);
    expect(() => jobLogPath(dir, "not-an-id")).toThrow(/not a ticket id/u);
  }, 30_000);
});
