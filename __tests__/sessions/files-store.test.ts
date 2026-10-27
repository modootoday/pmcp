import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    // A new write lands in sessions/ and, for readers of the deprecated path, in fleet/.
    for (const folder of ["sessions", "fleet"])
      expect(
        JSON.parse(
          readFileSync(join(state, folder, "abcd1234-session.json"), "utf8"),
        ),
      ).toMatchObject({ session: "abcd1234-session", alias: "kit" });
  });

  it("reads a record written before 0.20 that only fleet/ holds, and lists each session once", (t) => {
    const state = dir(t);
    mkdirSync(join(state, "fleet"), { recursive: true });
    writeFileSync(
      join(state, "fleet/old0old0-session.json"),
      JSON.stringify({ session: "old0old0-session", alias: "old" }),
    );
    const store = createFilesStore(state);
    expect(store.registry.get("old0old0-session")?.alias).toBe("old");
    store.registry.upsert("new0new0-session", { cwd: state, alias: "new" });
    // A record in both places is read from sessions/ and listed once.
    writeFileSync(
      join(state, "fleet/new0new0-session.json"),
      JSON.stringify({ session: "new0new0-session", alias: "stale" }),
    );
    expect(store.registry.get("new0new0-session")?.alias).toBe("new");
    expect(
      store.registry
        .list()
        .map((record) => `${record.session}=${record.alias}`)
        .sort(),
    ).toEqual(["new0new0-session=new", "old0old0-session=old"]);
    store.registry.remove("new0new0-session");
    for (const folder of ["sessions", "fleet"])
      expect(existsSync(join(state, folder, "new0new0-session.json"))).toBe(
        false,
      );
  });

  it("follows a pmcp before 0.20 that updates fleet/ alone in the same directory", (t) => {
    const state = dir(t);
    const store = createFilesStore(state);
    store.registry.upsert("mix0mix0-session", { cwd: state, alias: "kit" });
    // The older writer adds a field and a later updatedAt to its own copy only.
    const legacy = join(state, "fleet/mix0mix0-session.json");
    const older = JSON.parse(readFileSync(legacy, "utf8"));
    writeFileSync(
      legacy,
      JSON.stringify({
        ...older,
        seenBroadcast: 7,
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    expect(store.registry.get("mix0mix0-session")?.seenBroadcast).toBe(7);
    expect(store.registry.list()[0]?.seenBroadcast).toBe(7);
    // A newer write starts from that copy, so nothing the older writer added is lost.
    store.registry.upsert("mix0mix0-session", { lastAction: "edit" });
    for (const folder of ["sessions", "fleet"])
      expect(
        JSON.parse(
          readFileSync(join(state, folder, "mix0mix0-session.json"), "utf8"),
        ),
      ).toMatchObject({ seenBroadcast: 7, lastAction: "edit" });
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
