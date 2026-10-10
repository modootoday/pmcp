/**
 * The skills the installed packages brought with them.
 *
 * Derived from `node_modules` at read time rather than from a list somebody
 * maintains: installing a package is how its skill arrives and uninstalling it
 * is how the skill leaves, so the catalog is always true of the project.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import {
  bodyOf,
  frontmatterObject,
  metadataOf,
  type MetadataValue,
  specProblems,
  stringFields,
} from "./frontmatter.js";
import { readMarketplace } from "./marketplace.js";

export interface SkillEntry {
  /** `<package>/<slug>`. Unique, and stable while the package is installed. */
  readonly name: string;
  readonly package: string;
  readonly slug: string;
  /** Frontmatter description. The only text `find` ranks against. */
  readonly description: string;
  /** Absolute path to the SKILL.md. `call` reads the body from here. */
  readonly path: string;
  /** open, free or paid. Set for marketplace skills, absent for packages. */
  readonly tier?: string;
  /** The frontmatter `metadata:` block; maps such as `requires` are kept one level down. */
  readonly metadata?: Readonly<Record<string, MetadataValue>>;
  /** Extra search terms. Ranked with the description, never used as triggers. */
  readonly keywords?: readonly string[];
  /** What the entry is. Absent means a skill. */
  readonly kind?: AssetKind;
  /**
   * What describe and read may open: a directory, or one file for an asset
   * that is a single file. Absent means the directory holding `path`.
   */
  readonly root?: string;
}

/** Everything the catalog serves. Commands are skills; workflows have no kind of their own. */
export const ASSET_KINDS = ["skill", "agent", "hook", "mcp"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const kindOf = (entry: Pick<SkillEntry, "kind">): AssetKind =>
  entry.kind ?? "skill";

export interface CatalogOptions {
  /** Directories to walk. Each is a `node_modules` root, not a package root. */
  readonly roots: readonly string[];
  /** Package name prefixes to consider. Empty means every package. */
  readonly scopes?: readonly string[];
  /** Installed local marketplace roots, without remote source fetching. */
  readonly marketplaces?: readonly string[];
  /** Package directories read directly, for a package no node_modules links. */
  readonly packages?: readonly string[];
  /** Workspace roots: the root and every member its workspaces globs name. */
  readonly workspaces?: readonly string[];
  /** Told about every marketplace skill left out, and why. */
  readonly onReject?: (rejection: { path: string; reason: string }) => void;
  /**
   * Told about a skill that is served but breaks the Agent Skills specification,
   * or that lost a name collision. Loading stays lenient, as the client guide asks.
   */
  readonly onWarning?: (warning: { path: string; reason: string }) => void;
}

/**
 * Directories a walk does not enter. Kept as short as the evidence allows: a
 * name here is a package whose skill will never be found, and the cost of one
 * extra readdir is far below the cost of missing a skill. Measured 20260906 --
 * `lib` was on this list and hid playwright's `lib/skill/SKILL.md`, which is
 * the most widely installed skill in the real world.
 */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".turbo",
  "coverage",
  "__tests__",
  "__fixtures__",
]);

/**
 * How deep below a package root a SKILL.md is looked for. Three reaches every
 * convention in use (skills, .agent/skills, .claude/skills, .gemini/skills,
 * .codex/skills); four was measured to find nothing more.
 */
export const MAX_SKILL_DEPTH = 3;

/**
 * Top-level scalar fields of a SKILL.md frontmatter, parsed as YAML, so a folded
 * `description: >-` arrives as its text rather than as the indicator.
 */
export function readFrontmatter(source: string): Record<string, string> {
  return stringFields(frontmatterObject(source));
}

/** The body after the frontmatter, or the whole file when there is none. */
export function readBody(source: string): string {
  return bodyOf(source);
}

/**
 * Every SKILL.md under a package root, found by shape rather than by path.
 *
 * One readdir sees every convention a package might use at once, so this costs
 * less than testing each known directory: measured over 500 packages, 735
 * syscalls against 3,584, and it keeps working when a new agent invents a path.
 */
function skillFiles(packageDir: string): string[] {
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

function packageDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === ".bin" || entry.name === ".cache") continue;
    const path = join(root, entry.name);
    // A scope directory holds packages rather than being one.
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

function readManifest(dir: string): Record<string, unknown> | null {
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

/** The workspaces field in either of its two shapes. */
function workspacePatterns(manifest: Record<string, unknown>): string[] {
  const field = manifest["workspaces"];
  const list = Array.isArray(field)
    ? field
    : (field as { packages?: unknown } | undefined)?.packages;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is string => typeof p === "string");
}

/** One level of {a,b} alternation, which is all workspace globs use. */
export function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/u.exec(pattern);
  if (!match) return [pattern];
  const head = pattern.slice(0, match.index);
  const tail = pattern.slice(match.index + match[0].length);
  return match[1]!
    .split(",")
    .flatMap((option) => expandBraces(`${head}${option}${tail}`));
}

function segmentMatcher(segment: string): RegExp {
  const body = segment
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${body}$`, "u");
}

/** Directories under base that a glob of literal, *, and ** segments names. */
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

/**
 * The root and its members, members first so a skill inside a member is
 * credited to the member rather than to the root that also contains it. A
 * member that declares its own workspaces is expanded the same way.
 */
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

function nameOf(dir: string, named: boolean): string {
  const manifestName = readManifest(dir)?.["name"];
  if (typeof manifestName === "string" && manifestName !== "") {
    return manifestName;
  }
  if (named) return basename(dir);
  return "";
}

/** A --workspace argument may itself be a glob, such as packages/*. */
export function expandRootGlob(dir: string): string[] {
  if (!dir.includes("*")) return [dir];
  const absolute = isAbsolute(dir);
  const base = absolute ? "/" : ".";
  return globDirs(base, dir)
    .filter((d) => existsSync(join(d, "package.json")))
    .sort();
}

/**
 * Every skill reachable from the given roots, sorted by name.
 *
 * A package with no skills directory contributes nothing and costs one
 * `existsSync` per convention. A skill with no description is skipped rather
 * than listed:
 * `find` ranks descriptions, so one without a description can only ever be
 * found by already knowing its name, and listing it would spend a session's
 * tokens on an entry that cannot answer.
 */
export function readCatalog(options: CatalogOptions): SkillEntry[] {
  const scopes = options.scopes ?? [];
  const found: SkillEntry[] = [];
  const seen = new Set<string>();
  // A workspace root's walk reaches into shallow members; one file, one entry.
  const seenPaths = new Set<string>();

  // A directory named directly may be a plain folder of skills with no manifest.
  const direct = new Set(options.packages ?? []);
  const packageDirsToRead = [
    ...options.roots.flatMap(packageDirs),
    ...direct,
    ...(options.workspaces ?? [])
      .flatMap(expandRootGlob)
      .flatMap(workspacePackageDirs),
  ];

  for (const packageDir of packageDirsToRead) {
    const packageName = nameOf(packageDir, direct.has(packageDir));
    if (packageName === "") continue;
    if (scopes.length > 0 && !scopes.some((s) => packageName.startsWith(s))) {
      continue;
    }

    for (const path of skillFiles(packageDir)) {
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);
      let source: string;
      try {
        source = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const parsed = frontmatterObject(source);
      const front = stringFields(parsed);
      const description = front["description"] ?? "";
      if (description === "") continue;
      // The directory holding the SKILL.md names it when frontmatter does
      // not. A skill at the package root falls back to the package name.
      const dirName = basename(dirname(path));
      const slug =
        front["name"] ??
        (dirName === basename(packageDir) ? packageName : dirName);
      const name = `${packageName}/${slug}`;
      // The first root wins: a nested node_modules holds an older copy of a
      // package the root already resolved, which is expected and not reported.
      if (seen.has(name)) {
        if (!path.includes("/node_modules/"))
          options.onWarning?.({
            path,
            reason: `duplicate name ${name}; the first one found is served`,
          });
        continue;
      }
      seen.add(name);
      for (const problem of specProblems(parsed, dirName))
        options.onWarning?.({ path, reason: problem });
      const metadata = metadataOf(parsed);
      found.push({
        name,
        package: packageName,
        slug,
        description,
        path,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
    }
  }

  for (const dir of options.marketplaces ?? []) {
    for (const entry of readMarketplace(dir, options.onReject)) {
      if (seen.has(entry.name)) {
        options.onReject?.({
          path: entry.path,
          reason: `duplicate name ${entry.name}`,
        });
        continue;
      }
      seen.add(entry.name);
      if (kindOf(entry) === "skill" && basename(entry.path) === "SKILL.md") {
        const parsed = frontmatterObject(readFileSync(entry.path, "utf8"));
        for (const problem of specProblems(
          parsed,
          basename(dirname(entry.path)),
        ))
          options.onWarning?.({ path: entry.path, reason: problem });
      }
      found.push(entry);
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** A catalog entry without its body, which is what `catalog` returns. */
export function withoutBody({
  path,
  ...rest
}: SkillEntry): Omit<SkillEntry, "path"> {
  void path;
  return rest;
}

/** Path relative to a root, for a message a reader can act on. */
export function displayPath(root: string, entry: SkillEntry): string {
  return relative(root, entry.path).replaceAll("\\", "/");
}
