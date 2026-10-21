import { kindOf, type SkillEntry } from "../catalog.js";
import { verifiedRuntimesOf } from "../runtime.js";
import type { SkillFilters } from "./types.js";
export function matches(
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
