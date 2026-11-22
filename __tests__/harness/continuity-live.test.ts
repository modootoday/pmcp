import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { headlessContinuityAdapter } from "../../src/harness/continuity/headless.js";
import { ContinuityJournal } from "../../src/harness/continuity/journal.js";
import { startContinuitySwitch } from "../../src/harness/continuity/switch.js";

for (const runtime of [
  "grok",
  "claude",
  "antigravity",
  "gemini",
  "codex",
] as const) {
  it.runIf(process.env.PMCP_CONTINUITY_LIVE === runtime)(
    `moves synthetic work and memory from Codex to ${runtime} and back`,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "pmcp-continuity-live-"));
      const worktreePath = mkdtempSync(join(directory, "work-"));
      const path = join(directory, "continuity.sqlite");
      const first = randomUUID();
      const second = randomUUID();
      const recordedAt = new Date().toISOString();
      try {
        let journal = await ContinuityJournal.open(path);
        try {
          journal.create({
            version: 1,
            sessionId: "live",
            workspaceId: "synthetic",
            worktreePath,
            revision: 0,
            activeRuntime: "codex",
            nativeSessions: [],
            events: [
              {
                kind: "work",
                summary: first,
                artifactPaths: [],
                sequence: 1,
                recordedAt,
              },
              {
                kind: "memory",
                key: "label",
                value: second,
                sequence: 2,
                recordedAt,
              },
            ],
          });
          const turn = async (
            target: Parameters<typeof headlessContinuityAdapter>[0],
            prompt: string,
            expected: string,
            includeHistory = true,
          ) => {
            const source = journal.read("live")!.checkpoint;
            const next = await startContinuitySwitch(
              journal,
              source,
              headlessContinuityAdapter(target, prompt),
              new Set(
                includeHistory
                  ? source.events.map((event) => event.sequence)
                  : [],
              ),
              AbortSignal.timeout(90_000),
            );
            expect(next.activeRuntime).toBe(target);
            expect(next.events.at(-1)).toMatchObject({
              kind: "message",
              role: "assistant",
              text: expected,
            });
            return next;
          };
          const initial = await turn(
            "codex",
            "Reply with only the previous work summary.",
            first,
          );
          const middle = await turn(
            runtime,
            "Reply with only the previous assistant answer, then a slash, then the label from memory. Use no spaces.",
            `${first}/${second}`,
          );
          const reopened = await ContinuityJournal.open(path);
          journal.close();
          journal = reopened;
          expect(journal.read("live")).toEqual({
            checkpoint: middle,
            pending: null,
          });
          const resumed = await turn(
            runtime,
            "Repeat only the exact answer you gave in the previous turn.",
            `${first}/${second}`,
            false,
          );
          expect(
            resumed.nativeSessions.find((ref) => ref.runtime === runtime)?.id,
          ).toBe(
            middle.nativeSessions.find((ref) => ref.runtime === runtime)?.id,
          );
          const last = await turn(
            "codex",
            "Reply with only the most recent assistant answer.",
            `${first}/${second}`,
          );
          expect(last.events.slice(0, resumed.events.length)).toEqual(
            resumed.events,
          );
          const finalId = last.nativeSessions.find(
            (ref) => ref.runtime === "codex",
          )?.id;
          if (runtime === "codex") {
            expect(finalId).toBe(initial.nativeSessions[0]?.id);
          } else {
            expect(finalId).not.toBe(initial.nativeSessions[0]?.id);
          }
          expect(journal.read("live")).toEqual({
            checkpoint: last,
            pending: null,
          });
        } finally {
          journal.close();
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    300_000,
  );
}
