import type { DeclaredMarketplace } from "./types.js";

interface CatalogFields {
  readonly marketplaces?: readonly string[];
  readonly builtin?: boolean;
}

// Honor explicit catalog selection so marketplace defaults cannot override operator intent.
export function withDeclaredCatalog<T extends CatalogFields>(
  catalog: T,
  declared: readonly DeclaredMarketplace[],
): T {
  const paths = declared.flatMap((entry) =>
    entry.catalog === true && entry.source.kind === "path"
      ? [entry.source.path]
      : [],
  );
  const builtin = declared.find(
    (entry) => entry.source.kind === "builtin" && entry.catalog !== undefined,
  );
  const merged = { ...catalog } as Record<string, unknown>;
  if (paths.length > 0)
    merged["marketplaces"] = [
      ...new Set([...(catalog.marketplaces ?? []), ...paths]),
    ];
  if (builtin && catalog.builtin === undefined)
    merged["builtin"] = builtin.catalog;
  return merged as T;
}
