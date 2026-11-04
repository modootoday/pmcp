import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { HeadTree } from "./tree.js";

// What the consumer graph needs from one source file. Keyed by blob id, so an entry can never
// describe other content; reading every source on each run cost most of a second.
export interface Facts {
  // Specifiers of imports that start with a parent directory step.
  readonly parents: readonly string[];
  // Text after each import or from quote up to the next quote, relative specifiers left out.
  readonly heads: readonly string[];
}

const VERSION = 1;
const LIMIT = 100_000;
// Longer than any package name, so a head still shows the name and what follows it.
const HEAD_CHARS = 256;
const PARENT = /from\s+["'](\.\.\/[^"']*)["']/gu;
const OPENER = /(?:from|import)\s*\(?\s*["']/gu;

export function factsOf(text: string): Facts {
  const parents = [...text.matchAll(PARENT)].map((match) => match[1]!);
  const heads: string[] = [];
  for (const match of text.matchAll(OPENER)) {
    const start = match.index + match[0].length;
    const rest = text.slice(start, start + HEAD_CHARS);
    const quote = rest.search(/["']/u);
    const head = quote < 0 ? rest : rest.slice(0, quote);
    if (!head.startsWith("./") && !head.startsWith("../")) heads.push(head);
  }
  return { parents, heads: [...new Set(heads)] };
}

// The same answer as matching (from|import) ( "name/ or "name" in the file's text.
export function importsName(facts: Facts, name: string): boolean {
  return facts.heads.some(
    (head) => head === name || head.startsWith(`${name}/`),
  );
}

function cacheFile(): string {
  const base = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(base, "pmcp", "affected-sources.json");
}

type Stored = Record<string, readonly [readonly string[], readonly string[]]>;

function load(file: string): Stored {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      version?: number;
      entries?: Stored;
    };
    return value.version === VERSION && value.entries ? value.entries : {};
  } catch {
    return {};
  }
}

function save(file: string, entries: Stored): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: VERSION, entries }));
    renameSync(temporary, file);
  } catch {
    // An unwritten cache only costs the next run the reads.
  }
}

// Facts for each path, reading from the object store only the blobs the cache lacks.
export function readFacts(
  tree: HeadTree,
  paths: readonly string[],
): Map<string, Facts> {
  const file = cacheFile();
  const stored = load(file);
  const used: Stored = {};
  const missing: string[] = [];
  const ids = new Map<string, string>();
  for (const path of paths) {
    const id = tree.blobId(path);
    if (id === null) continue;
    ids.set(path, id);
    const hit = stored[id];
    if (hit) used[id] = hit;
    else missing.push(path);
  }
  tree.prefetch(missing);
  for (const path of missing) {
    const text = tree.text(path);
    if (text === null) continue;
    const facts = factsOf(text);
    used[ids.get(path)!] = [facts.parents, facts.heads];
  }
  const out = new Map<string, Facts>();
  for (const [path, id] of ids) {
    const entry = used[id];
    if (entry) out.set(path, { parents: entry[0], heads: entry[1] });
  }
  if (missing.length > 0) {
    const kept = Object.entries(stored).filter(([id]) => !(id in used));
    const room = LIMIT - Object.keys(used).length;
    const older = room > 0 ? kept.slice(-room) : [];
    save(file, { ...Object.fromEntries(older), ...used });
  }
  return out;
}
