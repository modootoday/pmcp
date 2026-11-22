import { describe, expect, it, vi } from "vitest";
import type {
  ContinuityAdapter,
  ContinuityCheckpoint,
  ContinuityEvent,
  ContinuityStart,
} from "../../src/harness/continuity/index.js";

const recordedAt = "2026-01-01T00:00:00Z";
const events = [
  {
    sequence: 1,
    recordedAt,
    kind: "message",
    role: "user",
    text: "Review the fixture.",
  },
  {
    sequence: 2,
    recordedAt,
    kind: "work",
    summary: "Reviewed",
    artifactPaths: ["fixture.txt"],
  },
  {
    sequence: 3,
    recordedAt,
    kind: "memory",
    key: "format",
    value: "plain text",
  },
] as const satisfies readonly ContinuityEvent[];

function checkpoint(): ContinuityCheckpoint {
  return {
    version: 1,
    sessionId: "pilot",
    workspaceId: "fixture",
    worktreePath: "/synthetic/worktree",
    revision: 1,
    activeRuntime: "codex",
    nativeSessions: [
      {
        runtime: "codex",
        id: "codex-original",
        throughSequence: 3,
        collectionCursor: null,
      },
    ],
    events,
  };
}

function adapter(runtime: ContinuityAdapter["runtime"], id: string) {
  return {
    runtime,
    capabilities: { nativeResume: true, handoff: true },
    collect: vi.fn<ContinuityAdapter["collect"]>(),
    start: vi
      .fn<ContinuityAdapter["start"]>()
      .mockResolvedValue({ nativeSessionId: id }),
  };
}

async function startPilot(
  source: ContinuityCheckpoint,
  target: ContinuityAdapter,
  omittedSequences: readonly number[] = [],
): Promise<ContinuityCheckpoint> {
  const tail = source.events.at(-1)?.sequence ?? 0;
  const current = source.nativeSessions.find(
    (session) => session.runtime === target.runtime,
  );
  const request: ContinuityStart =
    target.capabilities.nativeResume && current?.throughSequence === tail
      ? { kind: "resume", nativeSession: current }
      : {
          kind: "handoff",
          context: source.events.filter(
            (event) => !omittedSequences.includes(event.sequence),
          ),
          omittedSequences,
        };
  const { nativeSessionId } = await target.start(request, {
    worktreePath: source.worktreePath,
    attemptId: String(source.revision),
    signal: new AbortController().signal,
  });
  const cursor =
    request.kind === "resume" ? request.nativeSession.collectionCursor : null;
  return {
    ...source,
    activeRuntime: target.runtime,
    revision: source.revision + 1,
    nativeSessions: [
      ...source.nativeSessions.filter(
        (session) => session.runtime !== target.runtime,
      ),
      {
        runtime: target.runtime,
        id: nativeSessionId,
        throughSequence: tail,
        collectionCursor: cursor,
      },
    ],
  };
}

describe("session continuity contract pilot", () => {
  it("hands off bounded context while retaining the full ledger, then returns with new work", async () => {
    const claude = adapter("claude", "claude-new");
    const codex = adapter("codex", "codex-new");
    const onClaude = await startPilot(checkpoint(), claude, [1]);
    expect(claude.start.mock.calls[0]?.[0]).toEqual({
      kind: "handoff",
      context: events.slice(1),
      omittedSequences: [1],
    });
    expect(onClaude.events).toEqual(events);

    const followUp: ContinuityEvent = {
      sequence: 4,
      recordedAt,
      kind: "message",
      role: "assistant",
      text: "Claude reviewed the follow-up.",
    };
    const back = await startPilot(
      { ...onClaude, events: [...events, followUp] },
      codex,
    );
    expect(codex.start.mock.calls[0]?.[0]).toEqual({
      kind: "handoff",
      context: [...events, followUp],
      omittedSequences: [],
    });
    expect(back).toMatchObject({
      sessionId: "pilot",
      worktreePath: "/synthetic/worktree",
      activeRuntime: "codex",
      revision: 3,
      events: [...events, followUp],
    });
  });

  it("resumes a native binding that covers the current event tail", async () => {
    const source = checkpoint();
    const codex = adapter("codex", "codex-original");
    await startPilot(source, codex);
    expect(codex.start.mock.calls[0]?.[0]).toEqual({
      kind: "resume",
      nativeSession: source.nativeSessions[0],
    });
  });

  it("preserves the source checkpoint when destination startup fails", async () => {
    const source = checkpoint();
    const before = structuredClone(source);
    const claude = adapter("claude", "claude-new");
    claude.start.mockRejectedValueOnce(new Error("pilot startup failed"));
    await expect(startPilot(source, claude)).rejects.toThrow(
      "pilot startup failed",
    );
    expect(source).toEqual(before);
  });
});
