// Expose the ranking method so callers can distinguish lexical fallback from semantic results.

import type { SkillEntry } from "./catalog.js";
import { createHash } from "node:crypto";
import { normaliseIntent, type IntentCache } from "./intent.js";

export type Ranking = "semantic" | "lexical";

export interface Match {
  readonly name: string;
  readonly package: string;
  readonly description: string;
  readonly score: number;
}

export interface FindResult {
  readonly ranking: Ranking;
  readonly matches: readonly Match[];
}

// Let the consumer choose the encoder because model identity determines score meaning.
export interface Embedder {
  readonly modelId: string;
  readonly indexKey?: string;
  readonly dims: number;

  embed(text: string): Promise<Float32Array>;

  embedPassage?(text: string): Promise<Float32Array>;
}

export interface FindOptions {
  readonly entries: readonly SkillEntry[];
  readonly intent: string;
  readonly limit?: number;
  readonly embedder?: Embedder;
  readonly cache?: IntentCache;

  readonly vectors?: ReadonlyMap<string, Float32Array>;
}

export const DEFAULT_FIND_LIMIT = 5;

function tokens(text: string): string[] {
  return normaliseIntent(text).split(" ").filter(Boolean);
}

function bigrams(text: string): Set<string> {
  const flat = normaliseIntent(text).replaceAll(" ", "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < flat.length; i += 1) out.add(flat.slice(i, i + 2));
  return out;
}

// Keep lexical fallback dependency-free so optional encoder failures cannot disable search.
export function lexicalScore(intent: string, description: string): number {
  const wanted = tokens(intent);
  if (wanted.length === 0) return 0;
  const have = new Set(tokens(description));
  const overlap =
    wanted.filter((token) => have.has(token)).length / wanted.length;

  const a = bigrams(intent);
  const b = bigrams(description);
  if (a.size === 0 || b.size === 0) return overlap / 2;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  const dice = (2 * shared) / (a.size + b.size);

  return (overlap + dice) / 2;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Keep ranking independent of body reads so catalog search stays cheap.
export async function find(options: FindOptions): Promise<FindResult> {
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const semantic =
    options.embedder !== undefined &&
    options.vectors !== undefined &&
    options.vectors.size > 0;

  if (semantic) {
    const embedder = options.embedder!;
    const vectors = options.vectors!;
    const namespace = createHash("sha256")
      .update(embedder.indexKey ?? embedder.modelId)
      .digest("hex");
    const cacheKey = `${namespace} ${normaliseIntent(options.intent)}`;
    let query = options.cache?.get(cacheKey) ?? null;
    if (!query) {
      query = await embedder.embed(options.intent);
      options.cache?.put(cacheKey, query);
    }
    const scored: Match[] = [];
    for (const entry of options.entries) {
      const vector = vectors.get(entry.name);
      if (!vector || vector.length !== query.length) continue;
      scored.push({
        name: entry.name,
        package: entry.package,
        description: entry.description,
        score: cosine(query, vector),
      });
    }
    // Reject partial semantic coverage so missing vectors cannot distort the ranking.
    if (scored.length === options.entries.length) {
      return {
        ranking: "semantic",
        matches: rank(scored, limit),
      };
    }
  }

  return {
    ranking: "lexical",
    matches: rank(
      options.entries.map((entry) => ({
        name: entry.name,
        package: entry.package,
        description: entry.description,
        score: lexicalScore(options.intent, entry.description),
      })),
      limit,
    ),
  };
}

function rank(matches: Match[], limit: number): Match[] {
  return matches
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
