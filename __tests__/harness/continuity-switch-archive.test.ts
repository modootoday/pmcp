import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HISTORY_RUNTIMES } from "../../src/harness/continuity/import-history.js";
import type { ContinuityCheckpoint } from "../../src/harness/continuity/index.js";
import { ContinuityJournal } from "../../src/harness/continuity/journal.js";
import { startContinuitySwitch } from "../../src/harness/continuity/switch.js";

const recordedAt = "2026-01-01T00:00:00Z";
const checkpoint: ContinuityCheckpoint = {
  version: 1,
  sessionId: "pilot",
  workspaceId: "desk",
  worktreePath: "/synthetic/desk",
  revision: 0,
  activeRuntime: "codex",
  nativeSessions: [],
  events: [
    { sequence: 1, recordedAt, kind: "message", role: "user", text: "Example" },
    {
      sequence: 2,
      recordedAt,
      kind: "work",
      summary: "Edited",
      artifactPaths: ["fixture.txt"],
    },
    { sequence: 3, recordedAt, kind: "memory", key: "format", value: "text" },
  ],
};

it.each(HISTORY_RUNTIMES)(
  "persists complete JSONL before starting %s",
  async (runtime) => {
    const directory = await mkdtemp(join(tmpdir(), "pmcp-switch-"));
    const journal = await ContinuityJournal.open(
      join(directory, "session.sqlite"),
    );
    try {
      journal.create(checkpoint);
      const next = await startContinuitySwitch(
        journal,
        checkpoint,
        {
          runtime,
          capabilities: { nativeResume: true, handoff: true },
          async collect() {
            throw new Error("unexpected collection");
          },
          async start(request, { attemptId }) {
            const archive = join(
              journal.archiveDirectory,
              `${attemptId}.jsonl`,
            );
            expect((await stat(archive)).mode & 0o777).toBe(0o600);
            const [header, ...events] = (await readFile(archive, "utf8"))
              .trimEnd()
              .split("\n")
              .map((line) => JSON.parse(line));
            expect(header).toMatchObject({
              sessionId: "pilot",
              worktree: "/synthetic/desk",
              switch: { target: runtime },
            });
            expect(events).toEqual(checkpoint.events);
            expect(request).toMatchObject({
              kind: "handoff",
              context: [checkpoint.events[2]],
            });
            expect(journal.read("pilot")?.checkpoint.activeRuntime).toBe(
              "codex",
            );
            return { nativeSessionId: "destination" };
          },
        },
        new Set([3]),
        new AbortController().signal,
      );
      expect(next.activeRuntime).toBe(runtime);
      expect(next.lastArchive).toMatch(/\.jsonl$/u);
    } finally {
      journal.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("leaves the source intact and never starts the target if archive storage is unsafe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pmcp-switch-"));
  const journal = await ContinuityJournal.open(
    join(directory, "session.sqlite"),
  );
  try {
    journal.create(checkpoint);
    await symlink(directory, journal.archiveDirectory);
    await expect(
      startContinuitySwitch(
        journal,
        checkpoint,
        {
          runtime: "claude",
          capabilities: { nativeResume: true, handoff: true },
          async collect() {
            throw new Error("unexpected collection");
          },
          async start() {
            throw new Error("unexpected provider access");
          },
        },
        new Set(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("unsafe_continuity_archive_directory");
    expect(journal.read("pilot")).toEqual({ checkpoint, pending: null });
  } finally {
    journal.close();
    await rm(directory, { recursive: true, force: true });
  }
});
