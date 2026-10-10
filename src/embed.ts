/**
 * The optional encoder and the store for the vectors it produces.
 *
 * Neither the model nor its runtime is a dependency: a caller who wants
 * semantic ranking installs the peer and runs `pmcp index`, and everything
 * here degrades to null rather than throwing when that has not happened.
 */

import type { Embedder } from "./find.js";
import { openDatabase, type SqliteHandle } from "./cache.js";
import { openSqlite } from "./storage/sqlite.js";
import { resolve } from "node:path";
import {
  resolveEncoder,
  type EncoderOptions,
  type ResolvedEncoder,
} from "./encoder.js";
export {
  DEFAULT_MODEL_ID,
  encoderSpec,
  embeddingModels,
  resolveEncoder,
} from "./encoder.js";
export type {
  EncoderSpec,
  EncoderOptions,
  EmbeddingModel,
  ResolvedEncoder,
} from "./encoder.js";

export interface LoadEmbedderOptions extends EncoderOptions {
  /** Where model files live; a host bakes them into its image here. */
  readonly cacheDir?: string;
  readonly modelPath?: string;
  /** Refuse to download, so a missing model is an error rather than a fetch. */
  readonly localOnly?: boolean;
  /** Injected for tests. The optional peer is imported otherwise. */
  readonly module?: unknown;
}

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
  options: { pooling: "mean" | "cls"; normalize: boolean },
) => Promise<FeatureExtractionOutput>;

interface TransformersModule {
  readonly pipeline?: unknown;
  readonly env?: Record<string, unknown>;
  readonly AutoTokenizer?: unknown;
  readonly AutoModel?: unknown;
  readonly AutoConfig?: unknown;
}

interface PretrainedFactory {
  from_pretrained(
    model: string,
    options: Record<string, unknown>,
  ): Promise<unknown>;
}

function pretrainedFactory(value: unknown): PretrainedFactory | null {
  if (!value || !["object", "function"].includes(typeof value)) return null;
  const candidate = value as PretrainedFactory;
  return typeof candidate.from_pretrained === "function" ? candidate : null;
}

async function loadProjectedEncoder(
  module: TransformersModule,
  selected: ResolvedEncoder,
  source: string,
  options: LoadEmbedderOptions,
): Promise<Pipeline | null> {
  const tokenizers = pretrainedFactory(module.AutoTokenizer);
  const models = pretrainedFactory(module.AutoModel);
  if (!tokenizers || !models) return null;
  const settings: Record<string, unknown> = {
    dtype: selected.dtype,
    revision: selected.revision,
    local_files_only: options.localOnly ?? false,
  };
  if (options.cacheDir !== undefined) settings.cache_dir = options.cacheDir;
  const modelSettings = { ...settings };
  if (selected.modelId === "onnx-community/embeddinggemma-2-ONNX") {
    const configurations = pretrainedFactory(module.AutoConfig);
    if (!configurations) return null;
    const config = (await configurations.from_pretrained(
      source,
      settings,
    )) as Record<string, unknown>;
    config.vision_config = null;
    config.audio_config = null;
    modelSettings.config = config;
  }
  const tokenizer = (await tokenizers.from_pretrained(source, settings)) as (
    text: string,
    options: Record<string, unknown>,
  ) => unknown;
  const model = (await models.from_pretrained(source, modelSettings)) as (
    inputs: unknown,
  ) => Promise<{ sentence_embedding?: FeatureExtractionOutput }>;
  return async (text) => {
    const output = await model(
      tokenizer(text, { padding: true, truncation: true }),
    );
    const vector = output.sentence_embedding;
    const gemma = selected.modelId.startsWith("onnx-community/embeddinggemma-");
    if (
      !vector ||
      vector.data.length === 0 ||
      (gemma && vector.data.length !== 768)
    )
      throw new Error(
        "EmbeddingGemma requires its projected 768-dimensional sentence_embedding",
      );
    if (!Array.from(vector.data).every(Number.isFinite))
      throw new Error("EmbeddingGemma returned a non-finite embedding");
    return vector;
  };
}

/**
 * Loads the encoder, or returns null when the peer is not installed.
 *
 * Absence is not failure anywhere in this package: the caller reports it and
 * ranking stays lexical.
 */
export async function loadEmbedder(
  modelId?: string,
  options: LoadEmbedderOptions = {},
): Promise<Embedder | null> {
  const selected = resolveEncoder(modelId, options);
  let module: TransformersModule;
  try {
    module = (options.module ??
      (await import(TRANSFORMERS))) as TransformersModule;
  } catch {
    return null;
  }
  let source = options.modelPath ?? selected.modelId;
  if (options.localOnly && !options.modelPath) {
    const cache = options.cacheDir ?? module.env?.cacheDir;
    if (typeof cache !== "string")
      throw new Error("Provide modelPath or cacheDir for an offline encoder");
    source = resolve(
      cache,
      selected.modelId,
      selected.revision === "main" ? "." : selected.revision,
    );
  }
  const spec = selected.encoder;
  let encode: Pipeline;
  if (spec.projected) {
    const projected = await loadProjectedEncoder(
      module,
      selected,
      source,
      options,
    );
    if (!projected) return null;
    encode = projected;
  } else {
    const factory = module.pipeline;
    if (typeof factory !== "function") return null;
    encode = (await (
      factory as (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => Promise<Pipeline>
    )("feature-extraction", source, {
      dtype: selected.dtype,
      revision: selected.revision,
      cache_dir: options.cacheDir,
      local_files_only: options.localOnly ?? false,
    })) as Pipeline;
  }

  let dims = 0;
  const run = async (text: string): Promise<Float32Array> => {
    const output = await encode(text, {
      pooling: spec.pooling,
      normalize: true,
    });
    let vector = Float32Array.from(output.data);
    if (vector.length === 0 || !vector.every(Number.isFinite))
      throw new Error("Encoder returned an invalid embedding");
    if (selected.dimensions !== undefined) {
      if (selected.dimensions > vector.length)
        throw new Error(
          "Encoder output is smaller than the requested dimensions",
        );
      vector = vector.slice(0, selected.dimensions);
      const norm = Math.hypot(...vector);
      if (norm === 0 || !Number.isFinite(norm))
        throw new Error("Encoder returned a zero embedding");
      vector = vector.map((value) => value / norm);
    }
    dims = vector.length;
    return vector;
  };
  return {
    modelId: selected.modelId,
    indexKey: selected.indexKey,
    get dims() {
      return dims;
    },
    embed: (text) => run(spec.queryPrefix + text),
    embedPassage: (text) => run(spec.passagePrefix + text),
  };
}

/**
 * One vector per entry, reusing those whose description has not changed.
 * Encoded as passages, the side the intent is compared against.
 */
export async function encodeEntries(
  embedder: Embedder,
  entries: readonly { readonly name: string; readonly description: string }[],
  previous: ReadonlyMap<
    string,
    { hash: string; vector: Float32Array }
  > = new Map(),
): Promise<Map<string, { hash: string; vector: Float32Array }>> {
  const out = new Map<string, { hash: string; vector: Float32Array }>();
  const passage = (text: string) =>
    embedder.embedPassage ? embedder.embedPassage(text) : embedder.embed(text);
  for (const entry of entries) {
    const hash = describeHash(entry.description);
    const kept = previous.get(entry.name);
    if (kept && kept.hash === hash) {
      out.set(entry.name, kept);
      continue;
    }
    out.set(entry.name, { hash, vector: await passage(entry.description) });
  }
  return out;
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
  options: { readOnly?: boolean } = {},
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
