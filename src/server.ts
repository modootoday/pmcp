/**
 * The three tools, and nothing else.
 *
 * The point of the server is that a session's startup cost does not grow with
 * the number of skills installed: the host lists three tools whatever the
 * catalog holds, and a body is read only when one is asked for.
 */

import { readFileSync } from "node:fs";

import { readBody, readCatalog, withoutBody, type CatalogOptions, type SkillEntry } from "./catalog.js";
import { find, type Embedder, type FindResult } from "./find.js";
import type { IntentCache } from "./intent.js";

export interface SkillServerOptions extends CatalogOptions {
  readonly embedder?: Embedder;
  readonly cache?: IntentCache;
  readonly vectors?: ReadonlyMap<string, Float32Array>;
  /** Injected for tests. Reads the catalog off disk otherwise. */
  readonly loadCatalog?: (options: CatalogOptions) => SkillEntry[];
}

export interface CatalogResponse {
  readonly count: number;
  readonly packages: readonly {
    readonly package: string;
    readonly skills: readonly { readonly name: string; readonly description: string }[];
  }[];
}

export interface CallResponse {
  readonly name: string;
  readonly body: string;
}

/**
 * The catalog, the search and the read, as plain functions.
 *
 * Separate from the MCP wiring so they can be exercised without a transport,
 * and so a consumer that wants them from a hook or a script is not made to
 * speak a protocol to get them.
 */
export function createSkillTools(options: SkillServerOptions) {
  const load = options.loadCatalog ?? readCatalog;
  let entries: SkillEntry[] | null = null;
  const catalog = (): SkillEntry[] => {
    entries ??= load({ roots: options.roots, scopes: options.scopes });
    return entries;
  };

  return {
    /** Grouped, and without bodies. The cheap overview and the search's miss path. */
    catalog(): CatalogResponse {
      const byPackage = new Map<string, { name: string; description: string }[]>();
      for (const entry of catalog()) {
        const list = byPackage.get(entry.package) ?? [];
        list.push({ name: entry.name, description: entry.description });
        byPackage.set(entry.package, list);
      }
      return {
        count: catalog().length,
        packages: [...byPackage.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([pkg, skills]) => ({ package: pkg, skills })),
      };
    },

    /** Ranked names. Returns; never loads a body. */
    find(intent: string, limit?: number): Promise<FindResult> {
      return find({
        entries: catalog(),
        intent,
        limit,
        embedder: options.embedder,
        cache: options.cache,
        vectors: options.vectors,
      });
    },

    /** One body, at the moment it is needed. */
    call(name: string): CallResponse | null {
      const entry = catalog().find((candidate) => candidate.name === name);
      if (!entry) return null;
      return { name: entry.name, body: readBody(readFileSync(entry.path, "utf8")) };
    },

    /** Drops the memoised catalog, so the next call re-reads the tree. */
    refresh(): void {
      entries = null;
    },

    entries: () => catalog().map(withoutBody),
  };
}

export type SkillTools = ReturnType<typeof createSkillTools>;
