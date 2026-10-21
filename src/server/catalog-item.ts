import { kindOf, type SkillEntry } from "../catalog.js";
import { type Runtime } from "../runtime.js";
import type { CatalogItem } from "../tools/schemas.js";
import { verification } from "./ranking.js";
export function catalogItem(
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
