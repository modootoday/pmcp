/**
 * skill:// URIs for skill files. The authority names this server's namespace and
 * resolves to nothing; the path is the catalog name, then the file inside it.
 */

import type { SkillEntry } from "../catalog.js";

export const SKILL_URI_AUTHORITY = "pmcp";

const PREFIX = `skill://${SKILL_URI_AUTHORITY}/`;

export const skillFileUri = (
  entry: Pick<SkillEntry, "name">,
  file = "SKILL.md",
): string => `${PREFIX}${entry.name}/${file}`;

/**
 * The catalog entry and relative file a URI names, matched against the entries
 * the caller may see. Names contain slashes, so the longest matching name wins.
 */
export function resolveSkillFileUri(
  uri: string,
  entries: readonly SkillEntry[],
): { entry: SkillEntry; file: string } | null {
  if (!uri.startsWith(PREFIX)) return null;
  const rest = decodeURI(uri.slice(PREFIX.length));
  let best: SkillEntry | null = null;
  for (const entry of entries) {
    if (!rest.startsWith(`${entry.name}/`)) continue;
    if (best === null || entry.name.length > best.name.length) best = entry;
  }
  if (best === null) return null;
  const file = rest.slice(best.name.length + 1);
  return file === "" ? null : { entry: best, file };
}
