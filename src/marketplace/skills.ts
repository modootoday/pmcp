import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type SkillEntry } from "../catalog.js";
import type { Context } from "./types.js";
import { markdownEntry } from "./markdown.js";
export function skillEntries(context: Context): SkillEntry[] {
  const dir = join(context.pluginDir, "skills");
  if (!existsSync(dir)) return [];
  const found: SkillEntry[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const path = join(dir, child.name, "SKILL.md");
    if (!existsSync(path)) continue;
    const entry = markdownEntry(context, path, child.name, {});
    if (entry) found.push(entry);
  }
  return found;
}
