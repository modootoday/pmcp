import type { RuntimeId } from "../../runtime/ids.js";

export interface NativeSessionRef {
  runtime: RuntimeId;
  id: string;
  throughSequence: number;
  collectionCursor: string | null;
}

export type ContinuityRecord =
  | { kind: "message"; role: "user" | "assistant"; text: string }
  | { kind: "work"; summary: string; artifactPaths: readonly string[] }
  | { kind: "memory"; key: string; value: string | null };

export type ContinuityEvent = {
  sequence: number;
  recordedAt: string;
} & ContinuityRecord;

export interface ContinuityCheckpoint {
  version: 1;
  sessionId: string;
  workspaceId: string;
  worktreePath: string;
  revision: number;
  activeRuntime: RuntimeId;
  lastArchive?: string;
  nativeSessions: readonly NativeSessionRef[];
  events: readonly ContinuityEvent[];
}

export type ContinuityStart =
  | { kind: "resume"; nativeSession: NativeSessionRef }
  | {
      kind: "handoff";
      context: readonly ContinuityEvent[];
      omittedSequences: readonly number[];
    };

export interface ContinuityAdapter {
  readonly runtime: RuntimeId;
  readonly capabilities: {
    nativeResume: boolean;
    handoff: boolean;
  };
  collect(
    session: NativeSessionRef,
    options: { signal: AbortSignal },
  ): Promise<{
    coverage: "complete" | "partial" | "unavailable";
    records: readonly (ContinuityRecord & { recordedAt: string })[];
    nextCursor: string | null;
  }>;
  start(
    request: ContinuityStart,
    options: { worktreePath: string; attemptId: string; signal: AbortSignal },
  ): Promise<{
    nativeSessionId: string;
    records?: readonly (ContinuityRecord & { recordedAt: string })[];
  }>;
}
