import { type Runtime } from "../runtime.js";
import type { CatalogItem, CatalogResponse } from "../tools/schemas.js";
import type { KindFilter } from "./types.js";
import type { ToolsContext } from "./types.js";
import { CATALOG_PAGE_SIZE } from "./_shared.js";
import { CATALOG_PAGE_MAX } from "./_shared.js";
import { matches } from "./filters.js";
import { verifiedFirst } from "./ranking.js";
import { catalogItem } from "./catalog-item.js";
export function catalogOperation(
  context: ToolsContext,
  request: {
    page?: number;
    pageSize?: number;
    tier?: string;
    kind?: KindFilter;
    runtime?: Runtime;
    verifiedOnly?: boolean;
    clientRuntime?: Runtime | null;
  } = {},
): CatalogResponse {
  const { options, catalog, byName } = context;
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
}
