import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { type SkillEntry } from "../catalog.js";
import type { Context } from "./types.js";
import { markdownEntry } from "./markdown.js";
export function commandEntries(context: Context): SkillEntry[] {
  const dir = join(context.pluginDir, "commands");
  if (!existsSync(dir)) return [];
  const found: SkillEntry[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isFile() || !child.name.endsWith(".md")) continue;
    const path = join(dir, child.name);
    const entry = markdownEntry(context, path, basename(child.name, ".md"), {
      root: path,
    });
    if (entry) found.push(entry);
  }
  return found;
}
