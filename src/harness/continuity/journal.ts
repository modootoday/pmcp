import { constants, openSync, closeSync, fstatSync } from "node:fs";
import { resolve } from "node:path";
import { openSqlite, type SqliteHandle } from "../../storage/sqlite.js";
import type { ContinuityCheckpoint, ContinuityRecord } from "./index.js";
import type { RuntimeId } from "../../runtime/ids.js";

export interface SwitchIntent {
  id: string;
  target: RuntimeId;
}

export interface JournalEntry {
  checkpoint: ContinuityCheckpoint;
  pending: SwitchIntent | null;
}

export class ContinuityJournal {
  private constructor(
    private readonly db: SqliteHandle,
    readonly archiveDirectory: string,
  ) {}

  static async open(path: string): Promise<ContinuityJournal> {
    const fd = openSync(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.()
      ) {
        throw new Error("unsafe_continuity_journal");
      }
    } finally {
      closeSync(fd);
    }
    const { db } = await openSqlite(path);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("PRAGMA synchronous = FULL");
      db.exec(`CREATE TABLE IF NOT EXISTS continuity_v1 (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        checkpoint TEXT NOT NULL,
        attempt_id TEXT,
        target TEXT
      )`);
      return new ContinuityJournal(db, `${resolve(path)}.checkpoints`);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  create(checkpoint: ContinuityCheckpoint): void {
    this.db
      .prepare(
        "INSERT INTO continuity_v1 (id, revision, checkpoint) VALUES (?, ?, ?)",
      )
      .run(
        checkpoint.sessionId,
        checkpoint.revision,
        JSON.stringify(checkpoint),
      );
  }

  read(id: string): JournalEntry | null {
    const row = this.db
      .prepare<{
        checkpoint: string;
        attempt_id: string | null;
        target: RuntimeId;
      }>(
        "SELECT checkpoint, attempt_id, target FROM continuity_v1 WHERE id = ?",
      )
      .get(id);
    if (!row) return null;
    const checkpoint = JSON.parse(row.checkpoint) as ContinuityCheckpoint;
    if (checkpoint.version !== 1 || checkpoint.sessionId !== id) {
      throw new Error("invalid_continuity_checkpoint");
    }
    return {
      checkpoint,
      pending:
        row.attempt_id === null
          ? null
          : { id: row.attempt_id, target: row.target },
    };
  }

  begin(
    checkpoint: ContinuityCheckpoint,
    expectedRevision: number,
    intent: SwitchIntent,
  ): void {
    if (checkpoint.revision !== expectedRevision + 1)
      throw new Error("invalid_continuity_revision");
    const updated = this.db
      .prepare(
        `UPDATE continuity_v1
      SET checkpoint = ?, revision = ?, attempt_id = ?, target = ?
      WHERE id = ? AND revision = ? AND attempt_id IS NULL
      RETURNING id`,
      )
      .get(
        JSON.stringify(checkpoint),
        checkpoint.revision,
        intent.id,
        intent.target,
        checkpoint.sessionId,
        expectedRevision,
      );
    if (!updated) throw new Error("continuity_conflict");
  }

  settle(
    sessionId: string,
    attemptId: string,
    nativeSessionId: string | null,
    records: readonly (ContinuityRecord & { recordedAt: string })[] = [],
  ): ContinuityCheckpoint {
    const entry = this.read(sessionId);
    if (!entry?.pending || entry.pending.id !== attemptId)
      throw new Error("continuity_conflict");
    const { checkpoint, pending } = entry;
    const next: ContinuityCheckpoint = {
      ...checkpoint,
      revision: checkpoint.revision + 1,
    };
    if (nativeSessionId !== null) {
      const tail = checkpoint.events.at(-1)?.sequence ?? 0;
      next.events = [
        ...checkpoint.events,
        ...records.map((record, index) => ({
          ...record,
          sequence: tail + index + 1,
        })),
      ];
      const existing = checkpoint.nativeSessions.find(
        (ref) => ref.runtime === pending.target,
      );
      next.activeRuntime = pending.target;
      next.nativeSessions = [
        ...checkpoint.nativeSessions.filter(
          (ref) => ref.runtime !== pending.target,
        ),
        {
          runtime: pending.target,
          id: nativeSessionId,
          throughSequence: tail + records.length,
          collectionCursor:
            existing?.id === nativeSessionId ? existing.collectionCursor : null,
        },
      ];
    }
    const updated = this.db
      .prepare(
        `UPDATE continuity_v1
      SET checkpoint = ?, revision = ?, attempt_id = NULL, target = NULL
      WHERE id = ? AND revision = ? AND attempt_id = ?
      RETURNING id`,
      )
      .get(
        JSON.stringify(next),
        next.revision,
        sessionId,
        checkpoint.revision,
        attemptId,
      );
    if (!updated) throw new Error("continuity_conflict");
    return next;
  }
}
