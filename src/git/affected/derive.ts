import { posix } from "node:path";

import type { Derive } from "./config.js";
import type { Member } from "./members.js";
import type { HeadTree } from "./tree.js";
import { extendsChain } from "./tsconfig.js";

const VITEST = /^vitest\.config\.(?:ts|mts|cts|js|mjs|cjs)$/u;
const TSCONFIG = /^tsconfig.*\.json$/u;

function vitestImports(tree: HeadTree, file: string): string[] {
  const text = tree.text(file);
  if (text === null) return [];
  const out: string[] = [];
  const specs = /(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/gu;
  for (const match of text.matchAll(specs)) {
    const target = posix.normalize(posix.join(posix.dirname(file), match[1]!));
    out.push(target);
    if (!/\.[a-z]+$/u.test(target))
      for (const ext of [".ts", ".mts", ".js", ".mjs"]) out.push(target + ext);
  }
  return out;
}

function inside(path: string, dirs: ReadonlySet<string>): boolean {
  for (let dir = path; dir !== "." && dir !== "/"; dir = posix.dirname(dir))
    if (dirs.has(dir)) return true;
  return false;
}

// Files outside every member that a member's own config reads, mapped to those members.
// Computed from the revision each run, so the answer cannot go stale the way a stored list does.
export function deriveReaders(
  tree: HeadTree,
  members: readonly Member[],
  adapters: readonly Derive[],
): Map<string, Set<string>> {
  const readers = new Map<string, Set<string>>();
  if (adapters.length === 0) return readers;
  const dirs = new Set(members.map((member) => member.dir));
  const byName = new Map(
    members.flatMap((member) =>
      member.name === undefined ? [] : [[member.name, member] as const],
    ),
  );
  const add = (target: string, member: string): void => {
    if (target.startsWith("..") || inside(target, dirs)) return;
    if (!readers.has(target)) readers.set(target, new Set());
    readers.get(target)!.add(member);
  };
  const configs = members.flatMap(({ dir }) =>
    tree
      .children(dir)
      .filter(
        (entry) =>
          (adapters.includes("tsconfig") && TSCONFIG.test(entry)) ||
          (adapters.includes("vitest") && VITEST.test(entry)),
      )
      .map((entry) => ({ dir, entry, file: `${dir}/${entry}` })),
  );
  tree.prefetch(configs.map(({ file }) => file));
  for (const { dir, entry, file } of configs) {
    if (adapters.includes("tsconfig") && TSCONFIG.test(entry))
      for (const step of extendsChain(tree, file, byName)) add(step.file, dir);
    if (adapters.includes("vitest") && VITEST.test(entry))
      for (const target of vitestImports(tree, file)) add(target, dir);
  }
  return readers;
}
