import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { type SkillEntry } from "../catalog.js";
import type { Context } from "./types.js";
import { markdownEntry } from "./markdown.js";
export function agentEntries(context: Context): SkillEntry[] {
  const dir = join(context.pluginDir, "agents");
  if (!existsSync(dir)) return [];
  const found: SkillEntry[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    let entry: SkillEntry | null = null;
    if (child.isFile() && child.name.endsWith(".md")) {
      const path = join(dir, child.name);
      entry = markdownEntry(context, path, basename(child.name, ".md"), {
        kind: "agent",
        root: path,
        namespace: "agents",
      });
    } else if (
      child.isDirectory() &&
      existsSync(join(dir, child.name, "agent.md"))
    ) {
      entry = markdownEntry(
        context,
        join(dir, child.name, "agent.md"),
        child.name,
        {
          kind: "agent",
          namespace: "agents",
        },
      );
    }
    if (entry) found.push(entry);
  }
  return found;
}
