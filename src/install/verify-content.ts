import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * What landed is checked against what the catalog described.
 *
 * The integrity in the catalog covers the archive, and npm discards the archive
 * once it extracts it, so nothing downstream can answer whether the installed
 * files are the ones that were paid for. A name and a version cannot answer it
 * either: those are what a package claims about itself, and any registry the
 * resolver happened to reach can claim them.
 */

const SKILL = "SKILL.md";
const SKIP = new Set(["node_modules", ".git", ".cache"]);

function skillFiles(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(path);
      else if (name === SKILL)
        found.set(
          relative(root, path).split(sep).join("/"),
          readFileSync(path, "utf8"),
        );
    }
  };
  walk(root);
  return found;
}

/** Must match the authoring side byte for byte, so it is written the same way. */
export function contentDigest(files: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const path of [...files.keys()].sort()) {
    const body = files.get(path)!;
    hash.update(`${path.length}:${path}:${body.length}:${body}`);
  }
  return `sha256:${hash.digest("hex")}`;
}

export interface ContentCheck {
  readonly packageName: string;
  readonly expected: string;
  readonly actual: string;
  readonly matched: boolean;
  readonly skillCount: number;
}

export function verifyInstalledContent(
  project: string,
  packageName: string,
  expected: string,
): ContentCheck {
  const root = resolve(project, "node_modules", ...packageName.split("/"));
  const files = skillFiles(root);
  const actual = contentDigest(files);
  return {
    packageName,
    expected,
    actual,
    matched: files.size > 0 && actual === expected,
    skillCount: files.size,
  };
}
