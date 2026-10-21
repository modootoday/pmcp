import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { ensureDaemon, unitText } from "../../src/harness/host/daemon.js";
import { ptyBinary } from "../../src/project/host.js";
import { hostDown, hostUp, type HostRun } from "../../src/harness/host/up.js";

type Req = Record<string, unknown>;

// A fake pmcp-pty: sessions with labels and liveness, enough for list, spawn, kill, wait, remove.
function fakeHost() {
  const sessions: {
    id: string;
    labels: Record<string, string>;
    alive: boolean;
  }[] = [];
  const seen: Req[] = [];
  let next = 1;
  const call = async (req: Req): Promise<Req> => {
    seen.push(req);
    const op = req["op"];
    if (op === "list") {
      const want = (req["labels"] ?? {}) as Record<string, string>;
      const hit = sessions.filter((s) =>
        Object.entries(want).every(([k, v]) => s.labels[k] === v),
      );
      return {
        ok: true,
        sessions: hit.map(({ id, alive }) => ({ id, alive })),
      };
    }
    if (op === "spawn") {
      const id = `s${next++}`;
      sessions.push({
        id,
        labels: req["labels"] as Record<string, string>,
        alive: true,
      });
      return { ok: true, id, pid: 100 + next, instance: "1-1" };
    }
    const s = sessions.find((x) => x.id === req["id"]);
    if (op === "kill" && s) s.alive = false;
    if (op === "remove" && s) sessions.splice(sessions.indexOf(s), 1);
    return { ok: true };
  };
  const exit = (name: string) =>
    sessions
      .filter((s) => s.labels["pmcp.host"] === name)
      .forEach((s) => (s.alive = false));
  return { call, seen, exit, sessions };
}

function approved(t: TestContext, roots = ["."], cwd = "app") {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-host-up-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const session = (name: string, restart: string) => ({
    name,
    profile: "claude",
    cwd,
    argv: ["claude"],
    labels: { "pmcp.host": name },
    restart,
    max_restarts: 1,
    delivery_setup: true,
  });
  writeFileSync(
    join(dir, "host.json"),
    JSON.stringify({
      version: 1,
      sessions: [session("lead", "on-exit"), session("helper", "no")],
    }),
  );
  writeFileSync(
    join(dir, "policy.json"),
    JSON.stringify({ version: 1, roots, allow: [], mcp_write: false }),
  );
  return dir;
}

function runOf(
  t: TestContext,
  call: HostRun["call"],
  roots?: string[],
  cwd?: string,
): HostRun {
  const dir = approved(t, roots, cwd);
  return {
    root: "/proj",
    approvedDir: dir,
    journal: join(dir, "runs", "host-runs.jsonl"),
    call,
  };
}

const actions = (steps: { name: string; action: string }[]) =>
  Object.fromEntries(steps.map((s) => [s.name, s.action]));

describe("pmcp harness host up and down", () => {
  it("starts each approved session once, restarts by policy up to its limit, and down resets", async (t) => {
    const host = fakeHost();
    const run = runOf(t, host.call);
    expect(actions(await hostUp(run))).toEqual({
      lead: "started",
      helper: "started",
    });
    const spawned = host.seen.find((r) => r["op"] === "spawn")!;
    expect(spawned).toMatchObject({
      cwd: "/proj/app",
      profile: "claude",
      delivery_setup: true,
      labels: { "pmcp.host": "lead" },
    });
    expect(actions(await hostUp(run))).toEqual({
      lead: "running",
      helper: "running",
    });
    host.exit("lead");
    host.exit("helper");
    expect(actions(await hostUp(run))).toEqual({
      lead: "restarted",
      helper: "exited",
    });
    host.exit("lead");
    expect(actions(await hostUp(run))).toEqual({
      lead: "exited",
      helper: "exited",
    });
    await hostDown(run);
    expect(host.sessions).toEqual([]);
    expect(actions(await hostUp(run))).toEqual({
      lead: "started",
      helper: "started",
    });
    const journal = readFileSync(run.journal, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).op);
    expect(journal).toEqual([
      "started",
      "started",
      "restarted",
      "stopped",
      "stopped",
      "started",
      "started",
    ]);
  });

  it("refuses a session whose cwd is outside the approved roots", async (t) => {
    const host = fakeHost();
    const steps = await hostUp(runOf(t, host.call, ["work"], "other"));
    expect(steps.every((s) => s.action === "refused")).toBe(true);
    expect(host.seen.some((r) => r["op"] === "spawn")).toBe(false);
  });

  it("starts pmcp-pty only when it does not answer, and reports the policy it loaded", async () => {
    let up = false;
    const call = async (): Promise<Req> => {
      if (!up) throw new Error("ENOENT");
      return { ok: true, policy: { loaded: true, from: "host-approval" } };
    };
    const state = await ensureDaemon(
      call,
      () => (up = true),
      undefined,
      1_000,
      async () => {},
    );
    expect(state).toEqual({ started: true, policy: "host-approval" });
    expect(
      await ensureDaemon(call, () => {
        throw new Error("must not start");
      }),
    ).toEqual({ started: false, policy: "host-approval" });
  });

  // Live: with pmcp-pty off PATH, up waited five seconds and said nothing about why.
  it("names the start's own output when pmcp-pty never answers", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-host-log-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const log = join(dir, "host-daemon.log");
    writeFileSync(log, "Failed to find executable pmcp-pty\n");
    const never = async (): Promise<Req> => {
      throw new Error("ENOENT");
    };
    await expect(
      ensureDaemon(
        never,
        () => {},
        log,
        300,
        async () => {},
      ),
    ).rejects.toThrow("its output: Failed to find executable pmcp-pty");
  });

  it("finds pmcp-pty from PMCP_PTY_BIN or PATH, and says so when it cannot", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-host-bin-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const bin = join(dir, "pmcp-pty");
    writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    expect(ptyBinary({ PATH: `/nonexistent:${dir}` })).toBe(bin);
    expect(ptyBinary({ PMCP_PTY_BIN: bin, PATH: "" })).toBe(bin);
    expect(
      ptyBinary({ PMCP_PTY_BIN: join(dir, "missing"), PATH: dir }),
    ).toBeNull();
    expect(() => unitText("/s", "/d", { PATH: "/nonexistent" })).toThrow(
      "pmcp-pty not found",
    );
    const text = unitText("/run/u/pmcp-pty.sock", "/s/host-approvals/abc", {
      PMCP_PTY_BIN: bin,
    });
    expect(text).toContain(
      `ExecStart=${bin} daemon --socket /run/u/pmcp-pty.sock --host /s/host-approvals/abc`,
    );
    expect(text).toContain("MemoryMax=4G");
  });
});
