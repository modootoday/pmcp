import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";

import { globPattern } from "../../glob.js";

export interface Member {
  readonly dir: string;
  readonly name?: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

// Hidden directories and installed packages are never members, as package managers skip them.
function skipped(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function manifestDirs(root: string): string[] {
  const out: string[] = [];
  const queue = [""];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory() && !skipped(entry.name)) queue.push(rel);
      else if (entry.name === "package.json" && dir !== "") out.push(dir);
    }
  }
  return out;
}

export function workspacePatterns(
  manifest: Readonly<Record<string, unknown>>,
): readonly string[] {
  const declared = manifest["workspaces"];
  const list = Array.isArray(declared)
    ? declared
    : (declared as { packages?: unknown } | undefined)?.packages;
  if (!Array.isArray(list) || !list.every((p) => typeof p === "string"))
    throw new Error("root package.json declares no workspaces list");
  return list as string[];
}

// The last matching pattern decides, so a leading ! removes what earlier patterns added.
export function memberMatcher(
  patterns: readonly string[],
): (dir: string) => boolean {
  const rules = patterns.map((pattern) => ({
    exclude: pattern.startsWith("!"),
    test: globPattern(pattern.replace(/^!/u, "").replace(/\/+$/u, ""), false),
  }));
  return (dir) => {
    let included = false;
    for (const rule of rules) if (rule.test.test(dir)) included = !rule.exclude;
    return included;
  };
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Members of an npm, bun, pnpm-compatible or yarn workspace as the checkout holds them.
export function workspaceMembers(root: string): Member[] {
  const rootManifest = readJson(join(root, "package.json"));
  if (rootManifest === null) throw new Error("root package.json is unreadable");
  const matches = memberMatcher(workspacePatterns(rootManifest));
  const members: Member[] = [];
  for (const dir of manifestDirs(root).filter(matches).sort()) {
    const manifest = readJson(join(root, dir, "package.json")) ?? {};
    const name = manifest["name"];
    members.push({
      dir,
      manifest,
      ...(typeof name === "string" ? { name } : {}),
    });
  }
  return members;
}
