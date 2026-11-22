import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ContinuityJournal } from "../../src/harness/continuity/journal.js";
import { startContinuitySwitch } from "../../src/harness/continuity/switch.js";

it("recovers a durable switch intent after a process is killed and settles it once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-continuity-"));
  const path = join(directory, "session.sqlite");
  try {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { ContinuityJournal } from './src/harness/continuity/journal.ts';
       const journal = await ContinuityJournal.open(process.argv[1]);
       const checkpoint = {
         version: 1, sessionId: 'pilot', workspaceId: 'fixture', worktreePath: '/synthetic',
         revision: 0, activeRuntime: 'codex', nativeSessions: [], events: []
       };
       journal.create(checkpoint);
       const events = [{
         sequence: 1, recordedAt: '2026-01-01T00:00:00Z', kind: 'memory',
         key: 'format', value: 'plain text'
       }];
       journal.begin({ ...checkpoint, revision: 1, events }, 0, { id: 'attempt', target: 'claude' });
       process.kill(process.pid, 'SIGKILL');`,
        path,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(child.signal, child.stderr).toBe("SIGKILL");
    const journal = await ContinuityJournal.open(path);
    try {
      const recovered = journal.read("pilot");
      expect(recovered).toMatchObject({
        checkpoint: {
          revision: 1,
          activeRuntime: "codex",
          events: [{ value: "plain text" }],
        },
        pending: { id: "attempt", target: "claude" },
      });
      const source = recovered!.checkpoint;
      expect(() =>
        journal.begin({ ...source, revision: 2 }, 1, {
          id: "duplicate",
          target: "claude",
        }),
      ).toThrow("continuity_conflict");
      expect(journal.settle("pilot", "attempt", null)).toMatchObject({
        revision: 2,
        activeRuntime: "codex",
        events: source.events,
      });
      journal.begin({ ...source, revision: 3 }, 2, {
        id: "retry",
        target: "claude",
      });
      expect(journal.settle("pilot", "retry", "claude-test")).toMatchObject({
        revision: 4,
        activeRuntime: "claude",
        nativeSessions: [{ id: "claude-test", throughSequence: 1 }],
      });
      expect(() => journal.settle("pilot", "retry", "claude-test")).toThrow(
        "continuity_conflict",
      );
      const current = journal.read("pilot")!.checkpoint;
      await expect(
        startContinuitySwitch(
          journal,
          current,
          {
            runtime: "codex",
            capabilities: { nativeResume: true, handoff: true },
            async collect() {
              throw new Error("unexpected collection");
            },
            async start(request, options) {
              expect(request).toMatchObject({
                kind: "handoff",
                context: current.events,
              });
              expect(journal.read("pilot")?.pending?.id).toBe(
                options.attemptId,
              );
              throw new Error("provider result uncertain");
            },
          },
          new Set([1]),
          new AbortController().signal,
        ),
      ).rejects.toThrow("provider result uncertain");
      expect(journal.read("pilot")).toMatchObject({
        checkpoint: { activeRuntime: "claude", events: current.events },
        pending: { target: "codex" },
      });
    } finally {
      journal.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
