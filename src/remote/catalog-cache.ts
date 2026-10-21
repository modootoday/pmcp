import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Reuse entity tags so unchanged catalogs do not require downloading the same bytes.
export interface CachedCatalog {
  readonly etag: string;
  readonly body: string;
}

export interface CatalogCache {
  read(origin: string): CachedCatalog | null;
  write(origin: string, entry: CachedCatalog): void;
}

const MAX_CACHE_BYTES = 8 * 1024 * 1024;

export function memoryCatalogCache(): CatalogCache {
  const held = new Map<string, CachedCatalog>();
  return {
    read: (origin) => held.get(origin) ?? null,
    write: (origin, entry) => {
      held.set(origin, entry);
    },
  };
}

// Bound the public cache to one origin so switching hubs cannot grow it indefinitely.
export function fileCatalogCache(dir: string): CatalogCache {
  const path = join(dir, "catalog-cache.json");
  return {
    read(origin) {
      try {
        const raw = readFileSync(path, "utf8");
        if (raw.length > MAX_CACHE_BYTES) return null;
        const held: unknown = JSON.parse(raw);
        if (typeof held !== "object" || held === null) return null;
        const record = held as Record<string, unknown>;
        if (record["origin"] !== origin) return null;
        const etag = record["etag"];
        const body = record["body"];
        if (typeof etag !== "string" || typeof body !== "string") return null;
        return { etag, body };
      } catch {
        return null;
      }
    },
    write(origin, entry) {
      // Ignore cache-write failures so an optional optimization cannot break a working command.
      try {
        if (entry.body.length > MAX_CACHE_BYTES) return;
        mkdirSync(dir, { recursive: true });
        const temporary = `${path}.${String(process.pid)}`;
        writeFileSync(
          temporary,
          `${JSON.stringify({ origin, etag: entry.etag, body: entry.body })}\n`,
          { mode: 0o600 },
        );
        renameSync(temporary, path);
      } catch {
        return;
      }
    },
  };
}
