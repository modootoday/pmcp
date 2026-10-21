import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { SKIPPED_DIRS } from "./_shared.js";
export function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/u.exec(pattern);
  if (!match) return [pattern];
  const head = pattern.slice(0, match.index);
  const tail = pattern.slice(match.index + match[0].length);
  return match[1]!
    .split(",")
    .flatMap((option) => expandBraces(`${head}${option}${tail}`));
}
export function segmentMatcher(segment: string): RegExp {
  const body = segment
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${body}$`, "u");
}
export function globDirs(base: string, pattern: string): string[] {
  const segments = pattern.split("/").filter((s) => s !== "" && s !== ".");
  const found = new Set<string>();
  const walk = (dir: string, index: number): void => {
    if (index === segments.length) {
      found.add(dir);
      return;
    }
    const segment = segments[index]!;
    if (!segment.includes("*")) {
      const next = join(dir, segment);
      if (existsSync(next)) walk(next, index + 1);
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const children = entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .filter((e) => !SKIPPED_DIRS.has(e.name));
    if (segment === "**") {
      walk(dir, index + 1);
      for (const child of children) walk(join(dir, child.name), index);
      return;
    }
    const matcher = segmentMatcher(segment);
    for (const child of children) {
      if (matcher.test(child.name)) walk(join(dir, child.name), index + 1);
    }
  };
  walk(base, 0);
  return [...found];
}
export function expandRootGlob(dir: string): string[] {
  if (!dir.includes("*")) return [dir];
  const absolute = isAbsolute(dir);
  const base = absolute ? "/" : ".";
  return globDirs(base, dir)
    .filter((d) => existsSync(join(d, "package.json")))
    .sort();
}
