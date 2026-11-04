import { posix } from "node:path";

import { globPattern } from "../../glob.js";
import type { HeadTree } from "./tree.js";

export interface Member {
  readonly dir: string;
  readonly name?: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

// Hidden directories and installed packages are never members, as package managers skip them.
function skipped(dir: string): boolean {
  return dir
    .split("/")
    .some((name) => name.startsWith(".") || name === "node_modules");
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

// Whether some pattern can match dir or a directory below it, so a submodule is worth listing.
function mayHold(patterns: readonly string[], dir: string): boolean {
  const parts = dir.split("/");
  return patterns.some((pattern) => {
    if (pattern.startsWith("!")) return false;
    const segments = pattern.replace(/\/+$/u, "").split("/");
    for (let at = 0; at < parts.length; at += 1) {
      const segment = segments[at];
      if (segment === undefined) return false;
      if (segment.includes("**")) return true;
      if (!globPattern(segment, false).test(parts[at]!)) return false;
    }
    return true;
  });
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Members of an npm, bun, pnpm-compatible or yarn workspace as the revision holds them.
export function workspaceMembers(tree: HeadTree): Member[] {
  const rootManifest = parseJson(tree.text("package.json"));
  if (rootManifest === null) throw new Error("root package.json is unreadable");
  const patterns = workspacePatterns(rootManifest);
  const matches = memberMatcher(patterns);
  const dirs = tree
    .files("", (link) => !skipped(link) && mayHold(patterns, link))
    .filter((path) => posix.basename(path) === "package.json")
    .map((path) => posix.dirname(path))
    .filter((dir) => dir !== "." && !skipped(dir) && matches(dir))
    .sort();
  tree.prefetch(dirs.map((dir) => `${dir}/package.json`));
  return dirs.map((dir) => {
    const manifest = parseJson(tree.text(`${dir}/package.json`)) ?? {};
    const name = manifest["name"];
    return { dir, manifest, ...(typeof name === "string" ? { name } : {}) };
  });
}
