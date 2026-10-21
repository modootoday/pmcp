import { openDatabase, type SqliteHandle } from "../cache.js";
import { openSqlite } from "../storage/sqlite.js";
import type { EntryVectorStore } from "./types.js";
import { ENTRY_SCHEMA } from "./_shared.js";
import { describeHash } from "./entries.js";
export async function openEntryVectors(
  path: string,
  options: {
    readOnly?: boolean;
  } = {},
): Promise<EntryVectorStore | null> {
  const opened = options.readOnly
    ? await openSqlite(path, options).catch(() => null)
    : await openDatabase(path);
  if (opened === null) return null;
  const db: SqliteHandle = opened.db;
  if (!options.readOnly) db.exec(ENTRY_SCHEMA);
  return {
    read(modelId) {
      const out = new Map<string, Float32Array>();
      const rows = db
        .prepare(
          "SELECT name, dims, vector FROM entry_vector WHERE model_id = ?",
        )
        .all(modelId) as Array<{
        name: string;
        dims: number;
        vector: unknown;
      }>;
      for (const row of rows) {
        const bytes = row.vector as Uint8Array;
        const vector = new Float32Array(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        );
        if (vector.length === row.dims) out.set(row.name, vector);
      }
      return out;
    },
    stale(modelId, entries) {
      const rows = db
        .prepare(
          "SELECT name, description_hash FROM entry_vector WHERE model_id = ?",
        )
        .all(modelId) as Array<{
        name: string;
        description_hash: string;
      }>;
      const stored = new Map(
        rows.map((row) => [row.name, row.description_hash]),
      );
      const out: string[] = [];
      for (const [name, description] of entries) {
        if (stored.get(name) !== describeHash(description)) out.push(name);
      }
      return out;
    },
    write(modelId, name, description, vector) {
      db.prepare(
        `INSERT INTO entry_vector (name, model_id, dims, description_hash, vector)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name, model_id) DO UPDATE SET
           dims = excluded.dims,
           description_hash = excluded.description_hash,
           vector = excluded.vector`,
      ).run(
        name,
        modelId,
        vector.length,
        describeHash(description),
        new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
      );
    },
    close() {
      db.close();
    },
  };
}
