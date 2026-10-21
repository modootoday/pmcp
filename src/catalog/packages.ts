import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { SKIPPED_DIRS } from "./_shared.js";
import { MAX_SKILL_DEPTH } from "./_shared.js";
export function skillFiles(packageDir: string): string[] {
  const found: string[] = [];
  const stack: Array<readonly [string, number]> = [[packageDir, 0]];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    const [dir, depth] = next;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        if (entry.name === "SKILL.md") found.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (SKIPPED_DIRS.has(entry.name)) continue;
      if (depth + 1 <= MAX_SKILL_DEPTH)
        stack.push([join(dir, entry.name), depth + 1]);
    }
  }
  return found.sort();
}
export function packageDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === ".bin" || entry.name === ".cache") continue;
    const path = join(root, entry.name);
    if (entry.name.startsWith("@")) {
      if (!existsSync(path)) continue;
      for (const scoped of readdirSync(path, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) {
          found.push(join(path, scoped.name));
        }
      }
      continue;
    }
    found.push(path);
  }
  return found;
}
export function readManifest(dir: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export function nameOf(dir: string, named: boolean): string {
  const manifestName = readManifest(dir)?.["name"];
  if (typeof manifestName === "string" && manifestName !== "") {
    return manifestName;
  }
  if (named) return basename(dir);
  return "";
}
