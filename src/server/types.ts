import {
  type AssetKind,
  type CatalogOptions,
  type SkillEntry,
} from "../catalog.js";
import { type Embedder } from "../find.js";
import type { IntentCache } from "../intent.js";
import { type BundleFile } from "../files/bundle.js";
import { type Runtime } from "../runtime.js";
import { createSkillTools } from "./tools.js";
export type KindFilter = AssetKind | "any";
export interface SkillFilters {
  readonly kind?: KindFilter;
  readonly tier?: string;
  readonly package?: string;
  readonly level?: string;
  readonly domain?: string;
  readonly medium?: string;
  readonly runtime?: Runtime;
  readonly verifiedOnly?: boolean;
}
export interface SkillServerOptions extends CatalogOptions {
  readonly embedder?: Embedder;
  readonly cache?: IntentCache;
  readonly vectors?: ReadonlyMap<string, Float32Array>;
  readonly loadCatalog?: (options: CatalogOptions) => SkillEntry[];
  readonly rankByClientRuntime?: boolean;
}
export interface CallResponse {
  readonly name: string;
  readonly body: string;
  readonly files: readonly BundleFile[];
  readonly filesTruncated: boolean;
}
export type SkillTools = ReturnType<typeof createSkillTools>;
export interface ToolsContext {
  readonly options: SkillServerOptions;
  readonly catalog: () => SkillEntry[];
  readonly byName: (name: string) => SkillEntry | null;
}
