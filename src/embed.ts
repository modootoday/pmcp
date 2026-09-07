/**
 * The optional encoder and the store for the vectors it produces.
 *
 * Neither the model nor its runtime is a dependency: a caller who wants
 * semantic ranking installs the peer and runs `pmcp index`, and everything
 * here degrades to null rather than throwing when that has not happened.
 */

import type { Embedder } from "./find.js";
import { openDatabase, type SqliteHandle } from "./cache.js";

/** What `pmcp index` writes and what the server reads back. */
export const DEFAULT_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

const ENTRY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS entry_vector (
    name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    dims INTEGER NOT NULL,
    description_hash TEXT NOT NULL,
    vector BLOB NOT NULL,
    PRIMARY KEY (name, model_id)
  );
`;

/**
 * Resolved through a variable so the compiler does not try to type a package
 * that is deliberately absent. A static import would make the optional peer
 * required at build time, which is the opposite of the point.
 */
const TRANSFORMERS = "@huggingface/transformers";

interface FeatureExtractionOutput {
  readonly data: ArrayLike<number>;
}

type Pipeline = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<FeatureExtractionOutput>;

/**
 * Loads the encoder, or returns null when the peer is not installed.
 *
 * Absence is not failure anywhere in this package: the caller reports it and
 * ranking stays lexical.
 */
export async function loadEmbedder(
  modelId: string = DEFAULT_MODEL_ID,
): Promise<Embedder | null> {
  let module: { pipeline?: unknown };
  try {
    module = (await import(TRANSFORMERS)) as { pipeline?: unknown };
  } catch {
    return null;
  }
  const factory = module.pipeline;
  if (typeof factory !== "function") return null;

  const encode = (await (
    factory as (task: string, model: string) => Promise<Pipeline>
  )("feature-extraction", modelId)) as Pipeline;

  let dims = 0;
  return {
    modelId,
    get dims() {
      return dims;
    },
    async embed(text: string): Promise<Float32Array> {
      const output = await encode(text, { pooling: "mean", normalize: true });
      const vector = Float32Array.from(output.data);
      dims = vector.length;
      return vector;
    },
  };
}

/** Stable identity for a description, so a reworded skill is re-encoded. */
export function describeHash(description: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < description.length; i++) {
    hash ^= description.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface EntryVectorStore {
  read(modelId: string): Map<string, Float32Array>;
  /** Names whose stored hash disagrees with the description they now have. */
  stale(modelId: string, entries: ReadonlyMap<string, string>): string[];
  write(
    modelId: string,
    name: string,
    description: string,
    vector: Float32Array,
  ): void;
  close(): void;
}

export async function openEntryVectors(
  path: string,
): Promise<EntryVectorStore | null> {
  const opened = await openDatabase(path);
  if (opened === null) return null;
  const db: SqliteHandle = opened.db;
  db.exec(ENTRY_SCHEMA);

  return {
    read(modelId) {
      const out = new Map<string, Float32Array>();
      const rows = db
        .prepare(
          "SELECT name, dims, vector FROM entry_vector WHERE model_id = ?",
        )
        .all(modelId) as Array<{ name: string; dims: number; vector: unknown }>;
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
        .all(modelId) as Array<{ name: string; description_hash: string }>;
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
