import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the client already holds, so a catalog that has not moved costs no
 * bytes. The hub has answered If-None-Match since it shipped; nothing sent it.
 */
export interface CachedCatalog {
  readonly etag: string;
  readonly body: string;
}

export interface CatalogCache {
  read(origin: string): CachedCatalog | null;
  write(origin: string, entry: CachedCatalog): void;
}

/** Bounded well above a catalog and well below anything worth storing. */
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

/**
 * One origin at a time: a second hub replaces the file rather than growing it.
 * The cache holds the public catalog, so it carries no account and no
 * dependency list, and a miss is never an error.
 */
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
      // A cache that cannot be written is still a working command.
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
