// The URI authority is a namespace, so clients must not resolve it as a network host.

import type { SkillEntry } from "../catalog.js";

export const SKILL_URI_AUTHORITY = "pmcp";

const PREFIX = `skill://${SKILL_URI_AUTHORITY}/`;

export const skillFileUri = (
  entry: Pick<SkillEntry, "name">,
  file = "SKILL.md",
): string => `${PREFIX}${entry.name}/${file}`;

// Match the longest name because catalog names can themselves contain slashes.
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
