// Keep cache contracts separate so ranking does not load optional storage implementations.

export interface IntentCacheStats {
  readonly hits: number;
  readonly misses: number;

  readonly mismatched: number;
  readonly rows: number;

  readonly provider?: string;
}

export interface IntentCache {
  get(intent: string): Float32Array | null;
  put(intent: string, vector: Float32Array): void;
  stats(): IntentCacheStats;
  close(): void;
}

// Normalize canonically equivalent Unicode so equivalent intents share a cache key.
export function normaliseIntent(intent: string): string {
  return intent
    .normalize("NFC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ");
}
