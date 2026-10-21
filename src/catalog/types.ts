import { type MetadataValue } from "../frontmatter.js";
import { ASSET_KINDS } from "./_shared.js";
export interface SkillEntry {
  readonly name: string;
  readonly package: string;
  readonly slug: string;
  readonly description: string;
  readonly path: string;
  readonly tier?: string;
  readonly metadata?: Readonly<Record<string, MetadataValue>>;
  readonly keywords?: readonly string[];
  readonly kind?: AssetKind;
  readonly root?: string;
}
export type AssetKind = (typeof ASSET_KINDS)[number];
export interface CatalogOptions {
  readonly roots: readonly string[];
  readonly scopes?: readonly string[];
  readonly marketplaces?: readonly string[];
  readonly packages?: readonly string[];
  readonly workspaces?: readonly string[];
  readonly onReject?: (rejection: { path: string; reason: string }) => void;
  readonly onWarning?: (warning: { path: string; reason: string }) => void;
}
