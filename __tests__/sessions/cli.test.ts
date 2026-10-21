import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { createFilesStore } from "../../src/sessions/files-store.js";

function project(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-sessions-cli-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "pmcp.toml"),
    '[sessions]\nstate_dir = ".state"\n[sessions.leases.lockfile]\nblocks = [["bun", "install"]]\n',
  );
  const run = async (...argv: string[]) => {
    let output = "";
    const capture = { write: (text: string) => void (output += text) };
    const ui = new Ui({ stdout: capture, stderr: capture });
    const code = await dispatch(argv, { cwd: root, env: { HOME: root }, ui });
    return { code, output };
  };
  return { root, run, store: createFilesStore(join(root, ".state")) };
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

  it("refuses a pause without a reason and an unknown verb", async (t) => {
    const { run } = project(t);
    expect((await run("sessions", "pause")).code).toBe(2);
    expect((await run("sessions", "explode")).code).toBe(2);
  });
});
