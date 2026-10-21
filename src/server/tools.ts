import { readCatalog, withoutBody, type SkillEntry } from "../catalog.js";
import type {
  SkillServerOptions,
  KindFilter,
  SkillFilters,
  CallResponse,
} from "./types.js";
import type { Runtime } from "../runtime.js";
import type {
  CatalogResponse,
  DescribeResponse,
  FindResponse,
} from "../tools/schemas.js";
import type { ReadResult } from "../files/read.js";
import type { SkillBundle } from "../files/bundle.js";
import { catalogOperation } from "./catalog-page.js";
import { findOperation } from "./search.js";
import { describeOperation } from "./describe.js";
import { readOperation } from "./read.js";
import { bundleOperation } from "./bundle.js";
import { callOperation } from "./call.js";
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
  const byName = (name: string): SkillEntry | null => {
    const all = catalog();
    const exact = all.find((candidate) => candidate.name === name);
    if (exact) return exact;
    const suffix = `/${name.replace(/^\/+/, "")}`;
    const short = all.filter((candidate) => candidate.name.endsWith(suffix));
    return short.length === 1 ? short[0]! : null;
  };
  return {
    catalog(
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
      return catalogOperation({ options, catalog, byName }, request);
    },
    find(
      intent: string,
      limit?: number,
      filters?: SkillFilters,
      clientRuntime?: Runtime | null,
    ): Promise<FindResponse> {
      return findOperation(
        { options, catalog, byName },
        intent,
        limit,
        filters,
        clientRuntime,
      );
    },
    describe(name: string): DescribeResponse | null {
      return describeOperation({ options, catalog, byName }, name);
    },
    read(
      name: string,
      path?: string,
    ):
      | ReadResult
      | {
          ok: false;
          error: "unknown_skill";
          detail: string;
        } {
      return readOperation({ options, catalog, byName }, name, path);
    },
    bundle(name: string): SkillBundle | null {
      return bundleOperation({ options, catalog, byName }, name);
    },
    call(name: string): CallResponse | null {
      return callOperation({ options, catalog, byName }, name);
    },
    entry: (name: string): SkillEntry | null => byName(name),
    refresh(): void {
      entries = null;
    },
    entries: () => catalog().map(withoutBody),
    skills: (): readonly SkillEntry[] => catalog(),
  };
}
