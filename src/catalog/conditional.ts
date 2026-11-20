import { globPattern } from "../glob.js";
import { kindOf } from "./_shared.js";
import { expandBraces } from "./globs.js";
import type { AssetKind, SkillEntry } from "./types.js";

// Describes an entry candidate for conditional path-based activation matching.
export interface ConditionalCandidate {
  readonly name: string;
  readonly path?: string;
  readonly package?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly kind?: AssetKind;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly globs?: readonly string[] | string;
  readonly paths?: readonly string[] | string;
  readonly activation?:
    | {
        readonly globs?: readonly string[] | string;
        readonly paths?: readonly string[] | string;
        readonly always?: boolean | string;
        readonly mode?: string;
      }
    | string;
  readonly when?:
    | {
        readonly globs?: readonly string[] | string;
        readonly paths?: readonly string[] | string;
      }
    | readonly string[]
    | string;
  readonly load?: () => unknown;
}

// Options controlling path-based conditional activation matching.
export interface ConditionalMatcherOptions {
  readonly activePaths?: readonly string[];
  readonly activeGlobs?: readonly string[];
  readonly includeUnconditional?: boolean;
  readonly kind?: AssetKind | "any";
  readonly root?: string;
}

// Extracted activation criteria for a catalog entry.
export interface ExtractedConditions {
  readonly patterns: readonly string[];
  readonly isConditional: boolean;
  readonly always: boolean;
}

// Resolves candidate load return type when lazy loading is performed.
export type LoadedEntry<T> = T extends { load: () => infer R } ? Awaited<R> : T;

function normalizePath(p: string): string {
  return p
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");
}

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  return [];
}

function extractPatternsFromObject(obj: Record<string, unknown>): string[] {
  const result: string[] = [];
  if ("globs" in obj) result.push(...toStringArray(obj["globs"]));
  if ("paths" in obj) result.push(...toStringArray(obj["paths"]));
  if ("patterns" in obj) result.push(...toStringArray(obj["patterns"]));
  if ("files" in obj) result.push(...toStringArray(obj["files"]));
  return result;
}

// Extracts path and glob activation conditions from an entry's top-level or metadata fields.
export function extractEntryConditions(
  entry: ConditionalCandidate,
): ExtractedConditions {
  let always = false;
  const rawPatterns: string[] = [];

  if (entry.globs !== undefined)
    rawPatterns.push(...toStringArray(entry.globs));
  if (entry.paths !== undefined)
    rawPatterns.push(...toStringArray(entry.paths));

  if (typeof entry.when === "string" || Array.isArray(entry.when)) {
    rawPatterns.push(...toStringArray(entry.when));
  } else if (entry.when !== null && typeof entry.when === "object") {
    rawPatterns.push(
      ...extractPatternsFromObject(entry.when as Record<string, unknown>),
    );
  }

  if (typeof entry.activation === "string") {
    if (entry.activation === "always" || entry.activation === "eager") {
      always = true;
    }
  } else if (
    entry.activation !== null &&
    typeof entry.activation === "object"
  ) {
    const act = entry.activation as Record<string, unknown>;
    if (
      act["always"] === true ||
      act["always"] === "true" ||
      act["mode"] === "always" ||
      act["mode"] === "eager"
    ) {
      always = true;
    }
    rawPatterns.push(...extractPatternsFromObject(act));
  }

  const meta = entry.metadata;
  if (meta !== null && typeof meta === "object") {
    if ("globs" in meta) rawPatterns.push(...toStringArray(meta["globs"]));
    if ("paths" in meta) rawPatterns.push(...toStringArray(meta["paths"]));
    if ("patterns" in meta)
      rawPatterns.push(...toStringArray(meta["patterns"]));
    if ("always" in meta) {
      const a = meta["always"];
      if (a === true || a === "true") always = true;
    }
    if ("activation" in meta) {
      const act = meta["activation"];
      if (typeof act === "string") {
        if (act === "always" || act === "eager") always = true;
      } else if (act !== null && typeof act === "object") {
        const actObj = act as Record<string, unknown>;
        if (
          actObj["always"] === true ||
          actObj["always"] === "true" ||
          actObj["mode"] === "always" ||
          actObj["mode"] === "eager"
        ) {
          always = true;
        }
        rawPatterns.push(...extractPatternsFromObject(actObj));
      }
    }
    if ("when" in meta) {
      const when = meta["when"];
      if (typeof when === "string" || Array.isArray(when)) {
        rawPatterns.push(...toStringArray(when));
      } else if (when !== null && typeof when === "object") {
        rawPatterns.push(
          ...extractPatternsFromObject(when as Record<string, unknown>),
        );
      }
    }
  }

  const expanded: string[] = [];
  for (const p of rawPatterns) {
    const isNeg = p.startsWith("!");
    const bare = isNeg ? p.slice(1) : p;
    for (const item of expandBraces(bare)) {
      expanded.push(isNeg ? `!${item}` : item);
    }
  }

  const patterns = [...new Set(expanded)];
  return {
    patterns,
    isConditional: patterns.length > 0,
    always,
  };
}

// Returns true when an entry defines path or glob activation constraints.
export function isConditionalEntry(entry: ConditionalCandidate): boolean {
  return extractEntryConditions(entry).isConditional;
}

// Builds an ordered path matcher evaluating positive and negative rules.
export function createPathMatcher(
  patterns: readonly string[],
): (path: string) => boolean {
  if (patterns.length === 0) return () => false;

  const rules = patterns.map((p) => {
    const exclude = p.startsWith("!");
    const clean = normalizePath(p.replace(/^!/u, ""));
    const isDir =
      !clean.includes("*") &&
      !clean.includes("?") &&
      !/\.[a-zA-Z0-9_-]+$/u.test(clean);
    return {
      exclude,
      pattern: globPattern(clean, isDir),
    };
  });

  const hasPositive = rules.some((r) => !r.exclude);

  return (rawPath: string) => {
    const path = normalizePath(rawPath);
    let hit = !hasPositive;
    for (const rule of rules) {
      if (rule.pattern.test(path)) {
        hit = !rule.exclude;
      }
    }
    return hit;
  };
}

// Matches a single candidate against active workspace paths and globs.
export function matchEntry(
  entry: ConditionalCandidate,
  optionsOrPaths: ConditionalMatcherOptions | readonly string[] = {},
): boolean {
  const options: ConditionalMatcherOptions = Array.isArray(optionsOrPaths)
    ? { activePaths: optionsOrPaths }
    : (optionsOrPaths as ConditionalMatcherOptions);

  if (options.kind !== undefined && options.kind !== "any") {
    if (kindOf(entry as Pick<SkillEntry, "kind">) !== options.kind)
      return false;
  }

  const { patterns, isConditional, always } = extractEntryConditions(entry);
  if (always) return true;
  if (!isConditional) {
    return options.includeUnconditional ?? false;
  }

  const activePaths = options.activePaths ?? [];
  const root = options.root;

  const normalizedActivePaths = activePaths.map((p) => {
    let clean = p.replace(/\\/gu, "/");
    if (root && clean.startsWith(root)) {
      clean = clean.slice(root.length);
    }
    return normalizePath(clean);
  });

  const matcher = createPathMatcher(patterns);
  if (normalizedActivePaths.some((p) => matcher(p))) {
    return true;
  }

  const activeGlobs = options.activeGlobs ?? [];
  if (activeGlobs.length > 0) {
    for (const glob of activeGlobs) {
      const cleanGlob = normalizePath(glob.replace(/\\/gu, "/"));
      for (const pat of patterns) {
        if (pat.startsWith("!")) continue;
        const cleanPat = normalizePath(pat);
        if (cleanPat === cleanGlob) return true;
        if (globPattern(cleanGlob).test(cleanPat)) return true;
        if (globPattern(cleanPat).test(cleanGlob)) return true;
      }
    }
  }

  return false;
}

// Filters candidate catalog entries to those matching active workspace files or globs.
export function matchConditionalEntries<T extends ConditionalCandidate>(
  entries: readonly T[],
  optionsOrPaths: ConditionalMatcherOptions | readonly string[] = {},
): T[] {
  return entries.filter((entry) => matchEntry(entry, optionsOrPaths));
}

// Evaluates candidates and lazily loads only matching entries, skipping unrelated skills.
export async function loadConditionalEntries<T extends ConditionalCandidate>(
  entries: readonly T[],
  optionsOrPaths: ConditionalMatcherOptions | readonly string[] = {},
): Promise<Array<LoadedEntry<T>>> {
  const matched = matchConditionalEntries(entries, optionsOrPaths);
  const results: Array<LoadedEntry<T>> = [];
  for (const entry of matched) {
    if (typeof entry.load === "function") {
      results.push((await entry.load()) as LoadedEntry<T>);
    } else {
      results.push(entry as unknown as LoadedEntry<T>);
    }
  }
  return results;
}

// Synchronously evaluates candidates and lazily loads only matching entries.
export function loadConditionalEntriesSync<T extends ConditionalCandidate>(
  entries: readonly T[],
  optionsOrPaths: ConditionalMatcherOptions | readonly string[] = {},
): Array<T extends { load: () => infer R } ? R : T> {
  type Result = T extends { load: () => infer R } ? R : T;
  const matched = matchConditionalEntries(entries, optionsOrPaths);
  const results: Result[] = [];
  for (const entry of matched) {
    if (typeof entry.load === "function") {
      results.push(entry.load() as Result);
    } else {
      results.push(entry as unknown as Result);
    }
  }
  return results;
}
