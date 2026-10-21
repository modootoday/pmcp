import type { SkillEntry } from "./types.js";
import type { AssetKind } from "./types.js";
export const ASSET_KINDS = ["skill", "agent", "hook", "mcp"] as const;
export const kindOf = (entry: Pick<SkillEntry, "kind">): AssetKind =>
  entry.kind ?? "skill";
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".turbo",
  "coverage",
  "__tests__",
  "__fixtures__",
]);
export const MAX_SKILL_DEPTH = 3;
