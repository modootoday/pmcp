import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type {
  ContinuityAdapter,
  ContinuityCheckpoint,
  ContinuityStart,
} from "./index.js";
import type { ContinuityJournal } from "./journal.js";
import { saveSwitchArchive } from "./switch-archive.js";

export async function startContinuitySwitch(
  journal: ContinuityJournal,
  checkpoint: ContinuityCheckpoint,
  adapter: ContinuityAdapter,
  selectedSequences: ReadonlySet<number>,
  signal: AbortSignal,
): Promise<ContinuityCheckpoint> {
  signal.throwIfAborted();
  const tail = checkpoint.events.at(-1)?.sequence ?? 0;
  const current = checkpoint.nativeSessions.find(
    (session) =>
      session.runtime === adapter.runtime && session.throughSequence === tail,
  );
  const request: ContinuityStart =
    checkpoint.activeRuntime === adapter.runtime &&
    current &&
    adapter.capabilities.nativeResume
      ? { kind: "resume", nativeSession: current }
      : {
          kind: "handoff",
          context: checkpoint.events.filter((event) =>
            selectedSequences.has(event.sequence),
          ),
          omittedSequences: checkpoint.events
            .filter((event) => !selectedSequences.has(event.sequence))
            .map((event) => event.sequence),
        };
  if (request.kind === "handoff" && !adapter.capabilities.handoff) {
    throw new Error("continuity_handoff_unsupported");
  }
  const intent = { id: randomUUID(), target: adapter.runtime };
  const archive = await saveSwitchArchive(
    journal.archiveDirectory,
    checkpoint,
    intent,
  );
  try {
    signal.throwIfAborted();
    journal.begin(
      {
        ...checkpoint,
        lastArchive: archive,
        revision: checkpoint.revision + 1,
      },
      checkpoint.revision,
      intent,
    );
  } catch (error) {
    await rm(archive, { force: true });
    throw error;
  }
  const { nativeSessionId, records } = await adapter.start(request, {
    attemptId: intent.id,
    worktreePath: checkpoint.worktreePath,
    signal,
  });
  if (!nativeSessionId) throw new Error("missing_native_session_id");
  return journal.settle(
    checkpoint.sessionId,
    intent.id,
    nativeSessionId,
    records,
  );
}
