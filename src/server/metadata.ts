import { type SkillEntry } from "../catalog.js";
export function flatMetadata(
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
