/**
 * Query vectors, kept on disk between sessions.
 *
 * An MCP server starts per session and exits with it, so a process-local cache
 * begins empty every time and the same question pays its full embed cost in
 * every session that asks it. The table outlives the process; that is the whole
 * reason it is a table.
 */

import { normaliseIntent, type IntentCache } from "./intent.js";

/**
 * The slice of sqlite this file uses, which both runtimes provide under
 * different names.
 *
 * Imported dynamically and never statically: a static import of a builtin the
 * running binary does not have makes the whole package unloadable, which the
 * release gate's isolated runtime smoke catches.
 */
export interface SqliteStatement<Row> {
  get(...params: unknown[]): Row | undefined | null;
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): unknown;
}
export interface SqliteHandle {
  exec(sql: string): unknown;
  prepare<Row = unknown>(sql: string): SqliteStatement<Row>;
  close(): void;
}
type SqliteDatabase = SqliteHandle;

/** Which builtin answered, so a caller can report it rather than guess. */
export type SqliteProvider = "node:sqlite" | "bun:sqlite";

/**
 * Opens whichever sqlite the running binary has.
 *
 * `node:sqlite` exists on node and not on bun; `bun:sqlite` the other way
 * round. The server is wired to run under `node`, so that one is tried first,
 * but a consumer starting it under bun gets a working cache rather than a
 * silently disabled one — which is what a single-runtime import would give it.
 */
export async function openDatabase(
  path: string,
): Promise<{ db: SqliteDatabase; provider: SqliteProvider } | null> {
  try {
    // Assembled rather than written as a literal: esbuild strips the `node:`
    // prefix from a literal specifier it does not recognise as a builtin, and
    // `sqlite` alone resolves nowhere. Measured on esbuild 0.27.7 -- the source
    // worked and the bundle silently fell through to the other branch.
    const { DatabaseSync } = (await import(`node:${"sqlite"}`)) as unknown as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    return { db: new DatabaseSync(path), provider: "node:sqlite" };
  } catch {
    // Fall through to the other runtime's builtin.
  }
  try {
    const { Database } = (await import(`bun:${"sqlite"}`)) as unknown as {
      Database: new (
        path: string,
        options?: { create?: boolean },
      ) => {
        run(sql: string): unknown;
        query<Row>(sql: string): SqliteStatement<Row>;
        close(): void;
      };
    };
    const bun = new Database(path, { create: true });
    // Named differently, same operations. Adapted here so nothing below has to
    // know which binary it is running on.
    return {
      db: {
        exec: (sql) => bun.run(sql),
        prepare: <Row>(sql: string) => bun.query<Row>(sql),
        close: () => bun.close(),
      },
      provider: "bun:sqlite",
    };
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
  const touch = db.prepare("UPDATE intent_vector SET used_at = ? WHERE intent = ?");
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
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
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
      return { hits, misses, mismatched, rows: countRows.get()?.n ?? 0, provider };
    },

    close() {
      db.close();
    },
  };
}
