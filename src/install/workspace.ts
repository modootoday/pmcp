import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { expandBraces, globDirs, workspacePackageDirs } from "../catalog.js";

export function workspaceContains(root: string, project: string): boolean {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return workspacePackageDirs(root).includes(project);
  const value: unknown = parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid pnpm workspace configuration");
  const patterns = (value as Record<string, unknown>).packages ?? [];
  if (
    !Array.isArray(patterns) ||
    patterns.some((item) => typeof item !== "string")
  )
    throw new Error("pnpm workspace packages must be string patterns");
  const included = new Set<string>([root]);
  const excluded = new Set<string>();
  for (const raw of patterns as string[]) {
    const negated = raw.startsWith("!");
    const pattern = negated ? raw.slice(1) : raw;
    if (
      !pattern ||
      pattern.split("/").includes("..") ||
      pattern.startsWith("/")
    )
      throw new Error("workspace patterns must stay inside the workspace");
    for (const alternative of expandBraces(pattern)) {
      for (const match of globDirs(root, alternative)) {
        (negated ? excluded : included).add(realpathSync(match));
      }
    }
  }
  return project === root || (included.has(project) && !excluded.has(project));
}
