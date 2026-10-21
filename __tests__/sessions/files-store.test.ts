import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { filesSessionGate } from "../../src/git/mainline/store.js";
import { createFilesStore } from "../../src/sessions/files-store.js";

function dir(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "pmcp-files-store-"));
  t.onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

describe("files store", () => {
  it("writes pause, broadcast and records in its documented layout", (t) => {
    const state = dir(t);
    const store = createFilesStore(state);
    store.pause.write({ by: "operator", reason: "incident" });
    store.broadcast.post({ by: "operator", text: "freeze" });
    store.registry.upsert("abcd1234-session", { cwd: state, alias: "kit" });
    expect(
      JSON.parse(readFileSync(join(state, "pause.json"), "utf8")),
    ).toMatchObject({ by: "operator", reason: "incident" });
    expect(existsSync(join(state, "broadcast.json"))).toBe(true);
    expect(existsSync(join(state, "broadcast-history.jsonl"))).toBe(true);
    expect(
      JSON.parse(
        readFileSync(join(state, "fleet/abcd1234-session.json"), "utf8"),
      ),
    ).toMatchObject({ session: "abcd1234-session", alias: "kit" });
  });

  it("keeps only the configured number of broadcasts and withdraws them all", (t) => {
    const store = createFilesStore(dir(t), { keepBroadcasts: 2 });
    for (const text of ["a", "b", "c"])
      store.broadcast.post({ by: "operator", text });
    expect(store.broadcast.list().length).toBeLessThanOrEqual(2);
    store.broadcast.clear();
    expect(store.broadcast.list()).toEqual([]);
  });

  it("shares one lease file between git deliver and the hook store", (t) => {
    const state = dir(t);
    const gate = filesSessionGate(state);
    const lease = {
      pid: process.pid,
      subject: "deliver",
      cwd: state,
      since: "now",
    };
    expect(gate.leases.take("lockfile", lease)).toBe(true);
    expect(createFilesStore(state).leases.read("lockfile")).toMatchObject({
      subject: "deliver",
    });
    expect(existsSync(join(state, "lockfile-lease.json"))).toBe(true);
  });

  it("refuses an invalid session id and a second live lease holder", (t) => {
    const store = createFilesStore(dir(t));
    expect(store.registry.upsert("../escape", {})).toBeNull();
    expect(store.leases.take("lockfile", { subject: "mine" })).toBe(true);
    expect(
      store.leases.take("lockfile", { subject: "theirs", pid: process.ppid }),
    ).toBe(false);
    store.leases.release("lockfile");
    expect(store.leases.read("lockfile")).toBeNull();
  });
});
