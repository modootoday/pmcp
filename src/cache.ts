/**
 * Query vectors, kept on disk between sessions.
 *
 * An MCP server starts per session and exits with it, so a process-local cache
 * begins empty every time and the same question pays its full embed cost in
 * every session that asks it. The table outlives the process; that is the whole
 * reason it is a table.
 */

import { normaliseIntent, type IntentCache } from "./intent.js";

import { openSqlite, type SqliteProvider } from "./storage/sqlite.js";
export type {
  SqliteStatement,
  SqliteHandle,
  SqliteProvider,
} from "./storage/sqlite.js";

export async function openDatabase(
  path: string,
): Promise<Awaited<ReturnType<typeof openSqlite>> | null> {
  try {
    return await openSqlite(path);
  } catch {
    return null;
  }
}

export interface IntentCacheOptions {
  /** Database file. `:memory:` is accepted and is what the tests use. */
  readonly path: string;
  /** The embedder's identity. Rows from another model are never scored. */
  readonly modelId: string;
  /** Vector width. A row of a different width is a different model. */
  readonly dims: number;
  /** Rows kept. The least recently asked are dropped past this. */
  readonly limit?: number;
  /** Injected for tests. Real time otherwise. */
  readonly now?: () => number;
}

export const DEFAULT_INTENT_CACHE_LIMIT = 4096;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS intent_vector (
    intent   TEXT    NOT NULL PRIMARY KEY,
    model_id TEXT    NOT NULL,
    dims     INTEGER NOT NULL,
    vector   BLOB    NOT NULL,
    used_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS intent_vector_used_at ON intent_vector (used_at);
`;

/**
 * Opens the cache, or returns null when it cannot be opened.
 *
 * Null is the normal answer on a read-only volume, a locked file, a corrupt
 * database, or a runtime with neither builtin: the caller embeds on demand
 * instead. A cache that throws would turn a missing optimisation into a failed
 * search, and an older runtime is that case rather than an error.
 */
export async function openIntentCache(
  options: IntentCacheOptions,
): Promise<IntentCache | null> {
  const opened = await openDatabase(options.path);
  if (!opened) return null;
  const { db, provider } = opened;
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
  } catch {
    db.close();
    return null;
  }

  const limit = options.limit ?? DEFAULT_INTENT_CACHE_LIMIT;
  const now = options.now ?? (() => Date.now());
  let hits = 0;
  let misses = 0;
  let mismatched = 0;

  const selectRow = db.prepare<{
    model_id: string;
    dims: number;
    vector: Uint8Array;
  }>("SELECT model_id, dims, vector FROM intent_vector WHERE intent = ?");
  const touch = db.prepare(
    "UPDATE intent_vector SET used_at = ? WHERE intent = ?",
  );
  const upsert = db.prepare(
    `INSERT INTO intent_vector (intent, model_id, dims, vector, used_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(intent) DO UPDATE SET
       model_id = excluded.model_id,
       dims     = excluded.dims,
       vector   = excluded.vector,
       used_at  = excluded.used_at`,
  );
  const countRows = db.prepare<{ n: number }>(
    "SELECT count(*) AS n FROM intent_vector",
  );
  const evict = db.prepare(
    `DELETE FROM intent_vector WHERE intent IN (
       SELECT intent FROM intent_vector ORDER BY used_at ASC LIMIT ?
     )`,
  );

  return {
    get(intent) {
      const key = normaliseIntent(intent);
      const row = selectRow.get(key) ?? null;
      if (!row) {
        misses += 1;
        return null;
      }
      // Two models' distances are not comparable, so a row written by another
      // one is not a hit. It is left in place: it may be the current model
      // again after a rollback, and deleting it would lose that.
      if (row.model_id !== options.modelId || row.dims !== options.dims) {
        mismatched += 1;
        return null;
      }
      hits += 1;
      touch.run(now(), key);
      const bytes = row.vector;
      // Copied rather than viewed: the row's buffer is owned by the driver and
      // is not guaranteed to outlive the statement.
      return new Float32Array(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
    },

    put(intent, vector) {
      if (vector.length !== options.dims) {
        throw new Error(
          `intent vector is ${vector.length} wide, cache holds ${options.dims}`,
        );
      }
      const key = normaliseIntent(intent);
      upsert.run(
        key,
        options.modelId,
        options.dims,
        new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
        now(),
      );
      const rows = countRows.get()?.n ?? 0;
      if (rows > limit) evict.run(rows - limit);
    },

    stats() {
      return {
        hits,
        misses,
        mismatched,
        rows: countRows.get()?.n ?? 0,
        provider,
      };
    },

    close() {
      db.close();
    },
  };
}
