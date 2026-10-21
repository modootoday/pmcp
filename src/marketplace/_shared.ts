import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { containedPath } from "../marketplace/local.js";
import { type SkillEntry } from "../catalog.js";
import { type MetadataValue } from "../frontmatter.js";
export const asString = (
  value: MetadataValue | undefined,
): string | undefined => (typeof value === "string" ? value : undefined);
export const asList = (value: MetadataValue | undefined): readonly string[] => {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
};
export function readJson(
  path: string,
  root: string,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(containedPath(root, path), "utf8"),
    );
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export const assetRoot = (entry: Pick<SkillEntry, "root" | "path">): string =>
  entry.root ?? dirname(entry.path);
