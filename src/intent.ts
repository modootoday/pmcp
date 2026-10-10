/**
 * The intent key and the cache contract.
 *
 * Separate from the sqlite implementation so that ranking, which needs the key
 * and the interface, does not pull a bun-only module into a consumer running
 * under node. Only `cache.ts` requires bun.
 */

export interface IntentCacheStats {
  readonly hits: number;
  readonly misses: number;
  /** Rows found for the key but written by a different model. */
  readonly mismatched: number;
  readonly rows: number;
  /** Which sqlite builtin answered, or absent when there is no cache. */
  readonly provider?: string;
}

export interface IntentCache {
  /** The cached vector for an intent, or null when nothing usable is stored. */
  get(intent: string): Float32Array | null;
  put(intent: string, vector: Float32Array): void;
  stats(): IntentCacheStats;
  close(): void;
}

/**
 * Same question, differently typed. Case, punctuation and spacing only — the
 * key has to survive a caller writing "How do I wire X?" and "how do i wire x".
 */
export function normaliseIntent(intent: string): string {
  return intent
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ");
}
