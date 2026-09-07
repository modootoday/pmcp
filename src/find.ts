/**
 * Ranking an intent against skill descriptions.
 *
 * Semantic when an embedder is supplied, lexical otherwise, and the answer says
 * which. A caller that cannot tell the two apart cannot tell a degraded server
 * from a working one.
 */

import type { SkillEntry } from "./catalog.js";
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

/**
 * The encoder, supplied by the caller. There is no default and no bundled
 * model: which model runs decides what the scores mean, so it is the consuming
 * repository's declaration rather than this package's.
 */
export interface Embedder {
  readonly modelId: string;
  readonly dims: number;
  embed(text: string): Promise<Float32Array>;
}

export interface FindOptions {
  readonly entries: readonly SkillEntry[];
  readonly intent: string;
  readonly limit?: number;
  readonly embedder?: Embedder;
  readonly cache?: IntentCache;
  /** Precomputed description vectors, keyed by skill name. */
  readonly vectors?: ReadonlyMap<string, Float32Array>;
}

export const DEFAULT_FIND_LIMIT = 5;

function tokens(text: string): string[] {
  return normaliseIntent(text).split(" ").filter(Boolean);
}

/** Character bigrams, used for the overlap half of the lexical score. */
function bigrams(text: string): Set<string> {
  const flat = normaliseIntent(text).replaceAll(" ", "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < flat.length; i += 1) out.add(flat.slice(i, i + 2));
  return out;
}

/**
 * Token overlap and bigram Dice, averaged. Deterministic and dependency-free:
 * this is the answer when there is no model, so it must never be the thing
 * that fails.
 */
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

/** Cosine over two equal-width vectors. Zero when either has no magnitude. */
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

/**
 * Ranked matches, and which ranking produced them.
 *
 * Returns rather than loads: a search verb that also acts cannot be used to
 * look, and the whole reason this server exists is that looking should be
 * cheap.
 */
export async function find(options: FindOptions): Promise<FindResult> {
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const semantic =
    options.embedder !== undefined &&
    options.vectors !== undefined &&
    options.vectors.size > 0;

  if (semantic) {
    const embedder = options.embedder!;
    const vectors = options.vectors!;
    let query = options.cache?.get(options.intent) ?? null;
    if (!query) {
      query = await embedder.embed(options.intent);
      options.cache?.put(options.intent, query);
    }
    const scored: Match[] = [];
    for (const entry of options.entries) {
      const vector = vectors.get(entry.name);
      if (!vector) continue;
      scored.push({
        name: entry.name,
        package: entry.package,
        description: entry.description,
        score: cosine(query, vector),
      });
    }
    // Every entry missing a vector means the index does not cover this catalog,
    // and a partial semantic answer is worse than an honest lexical one.
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
