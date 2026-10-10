/**
 * The catalog operations the tools speak, as plain functions.
 *
 * The point of the server is that a session's startup cost does not grow with
 * the number of skills installed: the host lists a fixed set of tools whatever
 * the catalog holds, and a body is read only when one is asked for.
 */

import { readFileSync } from "node:fs";

import {
  kindOf,
  readBody,
  readCatalog,
  withoutBody,
  type AssetKind,
  type CatalogOptions,
  type SkillEntry,
} from "./catalog.js";
import { DEFAULT_FIND_LIMIT, find, type Embedder } from "./find.js";
import type { IntentCache } from "./intent.js";
import {
  bundleSkill,
  type BundleFile,
  type SkillBundle,
} from "./files/bundle.js";
import {
  FILE_LIST_LIMIT,
  listSkillFiles,
  type SkillFile,
} from "./files/list.js";
import {
  READ_BUDGET_BYTES,
  readSkillFile,
  type ReadResult,
} from "./files/read.js";
import { servedBytes } from "./files/redact.js";
import { ownFile } from "./files/resolve.js";
import { assetRoot, readFrontmatterText } from "./marketplace.js";
import { verifiedRuntimesOf, type Runtime } from "./runtime.js";
import type {
  CatalogItem,
  CatalogResponse,
  DescribeResponse,
  FindResponse,
} from "./tools/schemas.js";

export { READ_BUDGET_BYTES };
export type { BundleFile, ReadResult, SkillBundle, SkillFile };

/** How many files skill_describe lists before saying the rest were cut. */
export const DESCRIBE_FILE_LIMIT = FILE_LIST_LIMIT;

export const CATALOG_PAGE_SIZE = 8;
export const CATALOG_PAGE_MAX = 20;

/** A kind filter value: one kind, or every kind. */
export type KindFilter = AssetKind | "any";

/**
 * Equality filters over catalog fields. Unset keys match everything except
 * kind, which defaults to skill so a search for a skill never returns a hook.
 */
export interface SkillFilters {
  readonly kind?: KindFilter;
  readonly tier?: string;
  readonly package?: string;
  readonly level?: string;
  readonly domain?: string;
  readonly medium?: string;
  /** The runtime verified skills are ranked and marked for. Never filters by itself. */
  readonly runtime?: Runtime;
  /** Keep only skills verified on `runtime`, or on any runtime when it is unset. */
  readonly verifiedOnly?: boolean;
}

function matches(
  entry: SkillEntry,
  filters: SkillFilters | undefined,
): boolean {
  const kind = filters?.kind ?? "skill";
  if (kind !== "any" && kindOf(entry) !== kind) return false;
  if (!filters) return true;
  const meta = entry.metadata ?? {};
  const field = (key: string): string | undefined => {
    const value = meta[key];
    return typeof value === "string" ? value : undefined;
  };
  if (filters.tier !== undefined && entry.tier !== filters.tier) return false;
  if (filters.package !== undefined && entry.package !== filters.package)
    return false;
  if (filters.level !== undefined && field("level") !== filters.level)
    return false;
  if (filters.domain !== undefined && field("domain") !== filters.domain)
    return false;
  if (filters.medium !== undefined && field("medium") !== filters.medium)
    return false;
  if (filters.verifiedOnly) {
    const verified = verifiedRuntimesOf(entry.metadata);
    if (filters.runtime === undefined) return verified.length > 0;
    return verified.includes(filters.runtime);
  }
  return true;
}

/**
 * What a result says about verification: the list, and the mark when a runtime is in play.
 * Nothing unless the caller asked, so an answer to an older client keeps its old shape.
 */
function verification(
  entry: SkillEntry | undefined,
  runtime: Runtime | null,
  asked: boolean,
) {
  if (!asked) return {};
  const verifiedRuntimes = verifiedRuntimesOf(entry?.metadata);
  return {
    ...(verifiedRuntimes.length > 0 ? { verifiedRuntimes } : {}),
    ...(runtime === null
      ? {}
      : { verified: verifiedRuntimes.includes(runtime) }),
  };
}

/** Verified items first, each group in its given order. */
function verifiedFirst<T extends { readonly verified?: boolean }>(
  items: readonly T[],
): T[] {
  return [
    ...items.filter((item) => item.verified === true),
    ...items.filter((item) => item.verified !== true),
  ];
}

export interface SkillServerOptions extends CatalogOptions {
  readonly embedder?: Embedder;
  readonly cache?: IntentCache;
  readonly vectors?: ReadonlyMap<string, Float32Array>;
  /** Injected for tests. Reads the catalog off disk otherwise. */
  readonly loadCatalog?: (options: CatalogOptions) => SkillEntry[];
  /** Off by default so a call without a runtime input ranks exactly as before. */
  readonly rankByClientRuntime?: boolean;
}

export type { CatalogItem, CatalogResponse, DescribeResponse, FindResponse };

/** One catalog line. `kind` appears only for an asset that is not a skill. */
function catalogItem(
  entry: SkillEntry,
  runtime: Runtime | null,
  asked: boolean,
): CatalogItem {
  return {
    name: entry.name,
    description: entry.description,
    ...(entry.tier === undefined ? {} : { tier: entry.tier }),
    ...(kindOf(entry) === "skill" ? {} : { kind: kindOf(entry) }),
    ...verification(entry, runtime, asked),
  };
}

/** Nested metadata maps as dotted keys, the flat shape every client's schema accepts. */
function flatMetadata(
  metadata: SkillEntry["metadata"],
): Record<string, string | readonly string[]> {
  const flat: Record<string, string | readonly string[]> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (typeof value === "string" || Array.isArray(value)) {
      flat[key] = value as string | readonly string[];
      continue;
    }
    for (const [inner, leaf] of Object.entries(value ?? {})) {
      flat[`${key}.${inner}`] = leaf as string | readonly string[];
    }
  }
  return flat;
}

export interface CallResponse {
  readonly name: string;
  readonly body: string;
  /** Files the skill carries besides its body, for skill_read and resources/read. */
  readonly files: readonly BundleFile[];
  readonly filesTruncated: boolean;
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
    entries ??= load({
      roots: options.roots,
      scopes: options.scopes,
      marketplaces: options.marketplaces,
      packages: options.packages,
      workspaces: options.workspaces,
      onReject: options.onReject,
      onWarning: options.onWarning,
    });
    return entries;
  };
  const byName = (name: string): SkillEntry | null =>
    catalog().find((candidate) => candidate.name === name) ?? null;

  return {
    /**
     * Grouped, and without bodies. The cheap overview and the search's miss
     * path. Paged by package so a large catalog never arrives in one answer.
     */
    catalog(
      request: {
        page?: number;
        pageSize?: number;
        tier?: string;
        kind?: KindFilter;
        runtime?: Runtime;
        verifiedOnly?: boolean;
        /** The caller's own runtime, for ordering only. */
        clientRuntime?: Runtime | null;
      } = {},
    ): CatalogResponse {
      const client = options.rankByClientRuntime ? request.clientRuntime : null;
      const runtime = request.runtime ?? client ?? null;
      const asked = runtime !== null || request.verifiedOnly !== undefined;
      const byPackage = new Map<string, CatalogItem[]>();
      let count = 0;
      for (const entry of catalog()) {
        if (
          !matches(entry, {
            tier: request.tier,
            kind: request.kind,
            runtime: request.runtime,
            verifiedOnly: request.verifiedOnly,
          })
        )
          continue;
        count += 1;
        const list = byPackage.get(entry.package) ?? [];
        list.push(catalogItem(entry, runtime, asked));
        byPackage.set(entry.package, list);
      }
      const groups = [...byPackage.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pkg, skills]): [string, CatalogItem[]] => [
          pkg,
          runtime === null ? skills : verifiedFirst(skills),
        ]);
      const size = Math.min(
        Math.max(request.pageSize ?? CATALOG_PAGE_SIZE, 1),
        CATALOG_PAGE_MAX,
      );
      const totalPages = Math.max(1, Math.ceil(groups.length / size));
      const page = Math.min(Math.max(request.page ?? 1, 1), totalPages);
      return {
        count,
        page,
        totalPages,
        hasNext: page < totalPages,
        packages: groups
          .slice((page - 1) * size, page * size)
          .map(([pkg, skills]) => ({ package: pkg, skills })),
      };
    },

    /** Ranked names. Returns; never loads a body. */
    find(
      intent: string,
      limit?: number,
      filters?: SkillFilters,
      clientRuntime?: Runtime | null,
    ): Promise<FindResponse> {
      const client = options.rankByClientRuntime ? clientRuntime : null;
      const runtime = filters?.runtime ?? client ?? null;
      const asked = runtime !== null || filters?.verifiedOnly !== undefined;
      const scoped = catalog()
        .filter((entry) => matches(entry, filters))
        .map((entry) =>
          entry.keywords && entry.keywords.length > 0
            ? {
                ...entry,
                description: `${entry.description} ${entry.keywords.join(" ")}`,
              }
            : entry,
        );
      return find({
        entries: scoped,
        intent,
        limit: runtime === null ? limit : scoped.length,
        embedder: options.embedder,
        cache: options.cache,
        vectors: options.vectors,
      }).then((result) => {
        const marked = result.matches.map((match) => {
          const entry = byName(match.name) ?? undefined;
          return {
            ...match,
            description: entry?.description ?? match.description,
            ...verification(entry, runtime, asked),
          };
        });
        const ordered = runtime === null ? marked : verifiedFirst(marked);
        return {
          ...result,
          ...(asked ? { runtime } : {}),
          matches:
            runtime === null
              ? ordered
              : ordered.slice(0, limit ?? DEFAULT_FIND_LIMIT),
        };
      });
    },

    /** Every property of one skill and the files it carries, without bodies. */
    describe(name: string): DescribeResponse | null {
      const entry = byName(name);
      if (!entry) return null;
      const source = readFileSync(entry.path, "utf8");
      const listing = listSkillFiles(assetRoot(entry));
      return {
        name: entry.name,
        kind: kindOf(entry),
        package: entry.package,
        description: entry.description,
        ...(entry.tier === undefined ? {} : { tier: entry.tier }),
        metadata: flatMetadata(entry.metadata),
        frontmatter: readFrontmatterText(source),
        files: listing.files.map((file) => ({ ...file })),
        filesTruncated: listing.truncated,
      };
    },

    /**
     * One file inside a skill's directory. Paths that leave the directory,
     * directly or through a link, are refused; nothing is ever executed.
     */
    read(
      name: string,
      path?: string,
    ): ReadResult | { ok: false; error: "unknown_skill"; detail: string } {
      const entry = byName(name);
      if (!entry) return { ok: false, error: "unknown_skill", detail: name };
      return readSkillFile(entry, path);
    },

    /** Every file of one skill as links; the bytes stay out of the answer. */
    bundle(name: string): SkillBundle | null {
      const entry = byName(name);
      return entry ? bundleSkill(entry) : null;
    },

    /** One body, at the moment it is needed, and the other files it carries. */
    call(name: string): CallResponse | null {
      const entry = byName(name);
      if (!entry) return null;
      const bundle = bundleSkill(entry);
      const own = ownFile(entry);
      return {
        name: entry.name,
        body: readBody(
          servedBytes(entry.path, readFileSync(entry.path)).toString("utf8"),
        ),
        files: bundle.files.filter((file) => file.path !== own),
        filesTruncated: bundle.truncated,
      };
    },

    /** The catalog entry for a name, among those this caller may see. */
    entry: (name: string): SkillEntry | null => byName(name),

    /** Drops the memoised catalog, so the next call re-reads the tree. */
    refresh(): void {
      entries = null;
    },

    entries: () => catalog().map(withoutBody),

    /** The catalog with paths, for the Skills extension. The same array until refresh. */
    skills: (): readonly SkillEntry[] => catalog(),
  };
}

export type SkillTools = ReturnType<typeof createSkillTools>;
