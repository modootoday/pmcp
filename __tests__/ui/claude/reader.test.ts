import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseUiSettings,
  readSessionState,
  type StateFiles,
} from "../../../src/ui/claude/reader/index.js";

const FIXTURES = join(import.meta.dirname, "../../fixtures/ui-claude");
const NOW = Date.parse("2026-10-19T12:00:00.000Z");

function nodeFiles(alive: ReadonlySet<number>): StateFiles {
  return {
    exists: async (path) => {
      if (path.startsWith("/proc/")) return alive.has(Number(path.slice(6)));
      return existsSync(path);
    },
    read: async (path) => readFileSync(path, "utf8"),
    list: async (directory) => readdirSync(directory),
  };
}

const options = (stateDir: string) => ({
  stateDir: join(FIXTURES, stateDir),
  now: NOW,
});

describe("session state reader", () => {
  it("reads records, pause, lease and broadcast in the fleet formats", async () => {
    const snapshot = await readSessionState(
      nodeFiles(new Set([101, 4242])),
      options("state"),
    );
    expect(snapshot.records.map((r) => [r.session, r.alias])).toEqual([
      ["11111111-live", "main-desk"],
      ["22222222-recent", "desk-b"],
    ]);
    expect(snapshot.records[1]?.behind).toBe(2);
    expect(snapshot.pause).toEqual({
      by: "11111111-live",
      reason: "rebasing main",
      since: "2026-10-19T11:55:00.000Z",
    });
    expect(snapshot.lease?.subject).toBe("lockfile: add a parser");
    expect(snapshot.broadcast?.text).toBe("main is frozen until noon");
  });

  it("keeps a record while its runtime pid lives, past the heartbeat window", async () => {
    const live = await readSessionState(
      nodeFiles(new Set([101])),
      options("state"),
    );
    expect(live.records.map((r) => r.session)).toContain("11111111-live");
    const gone = await readSessionState(nodeFiles(new Set()), options("state"));
    expect(gone.records.map((r) => r.session)).toEqual(["22222222-recent"]);
  });

  it("drops a stale record whose session is gone and a lease whose holder died", async () => {
    const snapshot = await readSessionState(
      nodeFiles(new Set([101])),
      options("state"),
    );
    expect(snapshot.records.map((r) => r.session)).not.toContain(
      "33333333-gone",
    );
    expect(snapshot.lease).toBeNull();
  });

  it("shows a lease of any configured name, the live one held longest", async () => {
    const snapshot = await readSessionState(
      nodeFiles(new Set([4242])),
      options("leases"),
    );
    // schema-lease.json is older but its holder died; Not-A-lease.json is no lease name.
    expect(snapshot.lease?.subject).toBe("package-lock.json: add a parser");
  });

  it("treats malformed state files as absent", async () => {
    const snapshot = await readSessionState(
      nodeFiles(new Set()),
      options("broken"),
    );
    expect(snapshot).toEqual({
      records: [],
      pause: null,
      lease: null,
      broadcast: null,
    });
  });

  it("returns an empty snapshot for a state directory that does not exist", async () => {
    const snapshot = await readSessionState(
      nodeFiles(new Set()),
      options("absent"),
    );
    expect(snapshot.records).toEqual([]);
    expect(snapshot.pause).toBeNull();
  });

  it("reads the pause at [sessions] pause_file, not the state directory's", async () => {
    const snapshot = await readSessionState(nodeFiles(new Set()), {
      ...options("absent"),
      pauseFile: join(FIXTURES, "state/pause.json"),
    });
    expect(snapshot.pause?.reason).toBe("rebasing main");
    const elsewhere = await readSessionState(nodeFiles(new Set()), {
      ...options("state"),
      pauseFile: join(FIXTURES, "absent/pause.json"),
    });
    expect(elsewhere.pause).toBeNull();
  });
});

describe("mod settings", () => {
  const settings = {
    stateDir: ".state",
    sessionsPane: true,
    statusBand: false,
    commands: true,
    holdForeignEdits: false,
  };

  it("resolves a relative state directory against the project root", () => {
    expect(parseUiSettings(JSON.stringify(settings), "/repo")).toEqual({
      ...settings,
      stateDir: "/repo/.state",
    });
    const parent = { ...settings, stateDir: "../shared/state" };
    expect(
      parseUiSettings(JSON.stringify(parent), "/work/repo")?.stateDir,
    ).toBe("/work/shared/state");
  });

  it("leaves the state directory to the projected hook when none is declared", () => {
    const { stateDir: _declared, ...switches } = settings;
    expect(parseUiSettings(JSON.stringify(switches), "/repo")).toEqual(
      switches,
    );
  });

  it("reads the projected worktree root against the project root", () => {
    const withRoot = { ...settings, worktreeRoot: "../desks" };
    expect(
      parseUiSettings(JSON.stringify(withRoot), "/work/repo")?.worktreeRoot,
    ).toBe("/work/desks");
    expect(
      parseUiSettings(JSON.stringify({ ...settings, worktreeRoot: 3 }), "/r"),
    ).toBeNull();
  });

  it("leaves the mod off for a missing switch or unreadable file", () => {
    const { commands: _omitted, ...partial } = settings;
    expect(parseUiSettings(JSON.stringify(partial), "/repo")).toBeNull();
    expect(parseUiSettings("{", "/repo")).toBeNull();
  });
});
