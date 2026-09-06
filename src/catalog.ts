/**
 * The skills the installed packages brought with them.
 *
 * Derived from `node_modules` at read time rather than from a list somebody
 * maintains: installing a package is how its skill arrives and uninstalling it
 * is how the skill leaves, so the catalog is always true of the project.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export interface SkillEntry {
  /** `<package>/<slug>`. Unique, and stable while the package is installed. */
  readonly name: string;
  readonly package: string;
  readonly slug: string;
  /** Frontmatter description. The only text `find` ranks against. */
  readonly description: string;
  /** Absolute path to the SKILL.md. `call` reads the body from here. */
  readonly path: string;
}

export interface CatalogOptions {
  /** Directories to walk. Each is a `node_modules` root, not a package root. */
  readonly roots: readonly string[];
  /** Package name prefixes to consider. Empty means every package. */
  readonly scopes?: readonly string[];
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
 * Reads `name` and `description` out of YAML frontmatter without a parser.
 *
 * A parser is a dependency this server does not otherwise need, and the two
 * fields it wants are flat scalars on their own line. Anything more nested is
 * not read, which is the honest limit rather than a partial YAML.
 */
export function readFrontmatter(source: string): Record<string, string> {
  if (!source.startsWith("---")) return {};
  const end = source.indexOf("\n---", 3);
  if (end === -1) return {};
  const fields: Record<string, string> = {};
  for (const line of source.slice(3, end).split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const value = (match[2] ?? "").trim();
    if (value === "" || value.startsWith("#")) continue;
    fields[match[1]!] = value.replace(/^["'](.*)["']$/u, "$1");
  }
  return fields;
}

/**
 * The body after the frontmatter, or the whole file when there is none.
 *
 * The slice starts at the newline terminating the closing `---`, and a blank
 * line after it is separator rather than content, so both are dropped.
 */
export function readBody(source: string): string {
  if (!source.startsWith("---")) return source;
  const end = source.indexOf("\n---", 3);
  if (end === -1) return source;
  return source.slice(end + 4).replace(/^(?:\r?\n)+/u, "");
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
      if (depth + 1 <= MAX_SKILL_DEPTH) stack.push([join(dir, entry.name), depth + 1]);
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

  for (const root of options.roots) {
    for (const packageDir of packageDirs(root)) {
      const manifestPath = join(packageDir, "package.json");
      if (!existsSync(manifestPath)) continue;
      let packageName: string;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: string;
        };
        if (!manifest.name) continue;
        packageName = manifest.name;
      } catch {
        continue;
      }
      if (scopes.length > 0 && !scopes.some((s) => packageName.startsWith(s))) {
        continue;
      }

      for (const path of skillFiles(packageDir)) {
        let source: string;
        try {
          source = readFileSync(path, "utf8");
        } catch {
          continue;
        }
        const front = readFrontmatter(source);
        const description = front["description"] ?? "";
        if (description === "") continue;
        // The directory holding the SKILL.md names it when frontmatter does
        // not. A skill at the package root falls back to the package name.
        const dirName = basename(dirname(path));
        const slug = front["name"] ?? (dirName === basename(packageDir) ? packageName : dirName);
        const name = `${packageName}/${slug}`;
        // The first root wins: a nested node_modules holds an older copy of a
        // package the root already resolved.
        if (seen.has(name)) continue;
        seen.add(name);
        found.push({
          name,
          package: packageName,
          slug,
          description,
          path,
        });
      }
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** A catalog entry without its body, which is what `catalog` returns. */
export function withoutBody(entry: SkillEntry): Omit<SkillEntry, "path"> {
  const { path: _path, ...rest } = entry;
  return rest;
}

/** Path relative to a root, for a message a reader can act on. */
export function displayPath(root: string, entry: SkillEntry): string {
  return relative(root, entry.path).replaceAll("\\", "/");
}
