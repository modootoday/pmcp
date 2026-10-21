import { existsSync } from "node:fs";
import { join } from "node:path";
import { readManifest } from "./packages.js";
import { expandBraces } from "./globs.js";
import { globDirs } from "./globs.js";
export function workspacePatterns(manifest: Record<string, unknown>): string[] {
  const field = manifest["workspaces"];
  const list = Array.isArray(field)
    ? field
    : (
        field as
          | {
              packages?: unknown;
            }
          | undefined
      )?.packages;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is string => typeof p === "string");
}
export function workspacePackageDirs(root: string): string[] {
  const ordered: string[] = [];
  const visited = new Set<string>();
  const expand = (dir: string): void => {
    if (visited.has(dir)) return;
    visited.add(dir);
    const manifest = readManifest(dir);
    if (manifest === null) return;
    const included = new Set<string>();
    const excluded = new Set<string>();
    for (const raw of workspacePatterns(manifest)) {
      const negated = raw.startsWith("!");
      const pattern = negated ? raw.slice(1) : raw;
      for (const alternative of expandBraces(pattern)) {
        for (const match of globDirs(dir, alternative)) {
          (negated ? excluded : included).add(match);
        }
      }
    }
    const members = [...included]
      .filter((m) => !excluded.has(m) && existsSync(join(m, "package.json")))
      .sort();
    for (const member of members) expand(member);
    ordered.push(dir);
  };
  expand(root);
  return ordered;
}
