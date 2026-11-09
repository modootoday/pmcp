import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { createFilesStore } from "../../src/sessions/files-store.js";
import { operatorToken } from "../operator-token.js";

function project(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), "pmcp-sessions-cli-"));
  t.onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "project");
  mkdirSync(root);
  const operator = operatorToken(base);
  writeFileSync(
    join(root, "pmcp.toml"),
    `[sessions]\nstate_dir = ".state"\n[sessions.leases.lockfile]\nblocks = [["bun", "install"]]\n${operator.toml}`,
  );
  const runAs = async (
    env: Record<string, string>,
    ...argv: string[]
  ): Promise<{ code: number; output: string }> => {
    let output = "";
    const capture = { write: (text: string) => void (output += text) };
    const ui = new Ui({ stdout: capture, stderr: capture });
    const code = await dispatch(argv, {
      cwd: root,
      env: { HOME: root, ...env },
      ui,
    });
    return { code, output };
  };
  const run = (...argv: string[]) => runAs(operator.env, ...argv);
  const agent = (...argv: string[]) =>
    runAs({ CLAUDE_CODE_SESSION_ID: "abcd1234-live" }, ...argv);
  return { root, run, agent, store: createFilesStore(join(root, ".state")) };
}

describe("pmcp sessions", () => {
  it("pauses with a reason and an exempt sender, and resumes", async (t) => {
    const { run, store } = project(t);
    expect(
      (await run("sessions", "pause", "lockfile", "incident", "--by", "kit"))
        .code,
    ).toBe(0);
    expect(store.pause.read()).toMatchObject({
      by: "kit",
      reason: "lockfile incident",
    });
    expect((await run("sessions", "status")).output).toMatch(
      /PAUSED by kit .*lockfile incident/u,
    );
    await run("sessions", "resume");
    expect(store.pause.read()).toBeNull();
  });

  it("broadcasts, reports who has not seen it, and withdraws it", async (t) => {
    const { run, store } = project(t);
    store.registry.upsert("abcd1234-live", {
      alias: "kit",
      pid: process.pid,
      status: "idle",
    });
    await run("sessions", "broadcast", "freeze", "main");
    const status = (await run("sessions", "status")).output;
    expect(status).toMatch(/BROADCAST freeze main/u);
    expect(status).toMatch(/not seen yet by: kit/u);
    expect(status).toMatch(/^kit\s+idle/mu);
    await run("sessions", "unbroadcast");
    expect(store.broadcast.list()).toEqual([]);
  });

  it("shows a live lease and sweeps records whose process is gone", async (t) => {
    const { run, store } = project(t);
    store.leases.take("lockfile", { subject: "bump vitest" });
    store.registry.upsert("deadbeef-gone", { pid: 2 ** 30 });
    expect((await run("sessions", "status")).output).toMatch(
      /LEASE lockfile: bump vitest/u,
    );
    expect((await run("sessions", "sweep")).output).toMatch(
      /removed 1 stale record/u,
    );
  });

  it("leaves pause and resume to the operator and points an agent to them", async (t) => {
    const { agent, store } = project(t);
    const paused = await agent("sessions", "pause", "freeze");
    expect(paused.code).toBe(1);
    expect(paused.output).toContain(
      "pmcp sessions pause is the operator's to run",
    );
    expect(paused.output).toContain("Ask the operator");
    expect(store.pause.read()).toBeNull();
    store.pause.write({ by: "operator", reason: "freeze" });
    expect((await agent("sessions", "resume")).code).toBe(1);
    expect(store.pause.read()).toMatchObject({ reason: "freeze" });
  });

  it("signs a broadcast as the agent session, never as the operator", async (t) => {
    const { agent, store } = project(t);
    expect((await agent("sessions", "broadcast", "main moved")).code).toBe(0);
    expect(store.broadcast.list().at(-1)).toMatchObject({
      by: "abcd1234-live",
    });
    const forged = await agent(
      "sessions",
      "broadcast",
      "hi",
      "--by",
      "operator",
    );
    expect(forged.code).toBe(2);
    expect(forged.output).toContain("--by operator is for the operator");
  });

  it("refuses a pause without a reason and an unknown verb", async (t) => {
    const { run } = project(t);
    expect((await run("sessions", "pause")).code).toBe(2);
    expect((await run("sessions", "explode")).code).toBe(2);
  });
});
