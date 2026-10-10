import { existsSync } from "node:fs";
import {
  readCatalog,
  type CatalogOptions,
  type SkillEntry,
} from "./catalog.js";
import {
  DEFAULT_MODEL_ID,
  loadEmbedder,
  openEntryVectors,
  type LoadEmbedderOptions,
} from "./embed.js";
import { resolveEncoder } from "./encoder.js";
import type { Embedder, Ranking } from "./find.js";
import type { SkillServerOptions } from "./server.js";

export interface SearchOptions extends LoadEmbedderOptions {
  readonly indexPath: string;
  readonly modelId?: string;
  readonly embedder?: Embedder;
  readonly loadCatalog?: (options: CatalogOptions) => SkillEntry[];
}

export interface PreparedSearch {
  readonly ranking: Ranking;
  readonly reason?:
    | "index_missing"
    | "index_unavailable"
    | "index_stale"
    | "encoder_unavailable"
    | "vector_mismatch";
  readonly options: Pick<
    SkillServerOptions,
    "embedder" | "vectors" | "loadCatalog"
  >;
}

export async function prepareSearch(
  catalog: CatalogOptions,
  options: SearchOptions,
): Promise<PreparedSearch> {
  const lexical = (reason: PreparedSearch["reason"]): PreparedSearch => ({
    ranking: "lexical",
    reason,
    options: {},
  });
  if (!existsSync(options.indexPath)) return lexical("index_missing");
  let store: Awaited<ReturnType<typeof openEntryVectors>>;
  try {
    store = await openEntryVectors(options.indexPath, { readOnly: true });
  } catch {
    return lexical("index_unavailable");
  }
  if (!store) return lexical("index_unavailable");
  try {
    const entries = (options.loadCatalog ?? readCatalog)(catalog);
    const selected = resolveEncoder(
      options.modelId ?? options.embedder?.modelId ?? DEFAULT_MODEL_ID,
      options,
    );
    const modelId = selected.modelId;
    const key = selected.indexKey;
    if (
      options.embedder?.indexKey !== undefined &&
      options.embedder.indexKey !== key
    )
      return lexical("vector_mismatch");
    const descriptions = new Map(
      entries.map((entry) => [entry.name, entry.description]),
    );
    if (entries.length === 0 || store.stale(key, descriptions).length > 0)
      return lexical("index_stale");
    const vectors = store.read(key);
    const embedder =
      options.embedder ??
      (await loadEmbedder(selected.modelId, {
        ...options,
        localOnly: options.localOnly ?? true,
      }));
    if (!embedder || embedder.modelId !== modelId)
      return lexical("encoder_unavailable");
    if (embedder.indexKey !== undefined && embedder.indexKey !== key)
      return lexical("vector_mismatch");
    const probe = await embedder.embed("pmcp");
    if (
      probe.length === 0 ||
      !entries.every(
        (entry) => vectors.get(entry.name)?.length === probe.length,
      )
    )
      return lexical("vector_mismatch");
    return {
      ranking: "semantic",
      options: { embedder, vectors, loadCatalog: () => entries },
    };
  } catch {
    return lexical("encoder_unavailable");
  } finally {
    store.close();
  }
}
