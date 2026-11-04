import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import type { Derive } from "./config.js";
import type { Member } from "./members.js";
import { extendsChain } from "./tsconfig.js";

const VITEST = /^vitest\.config\.(?:ts|mts|cts|js|mjs|cjs)$/u;
const TSCONFIG = /^tsconfig.*\.json$/u;

function vitestImports(root: string, file: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    return [];
  }
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

function inside(path: string, dirs: readonly string[]): boolean {
  return dirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

// Files outside every member that a member's own config reads, mapped to those members.
// Computed from the checkout each run, so the answer cannot go stale the way a stored list does.
export function deriveReaders(
  root: string,
  members: readonly Member[],
  adapters: readonly Derive[],
): Map<string, Set<string>> {
  const readers = new Map<string, Set<string>>();
  if (adapters.length === 0) return readers;
  const dirs = members.map((member) => member.dir);
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
  for (const { dir } of members) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = `${dir}/${entry}`;
      if (adapters.includes("tsconfig") && TSCONFIG.test(entry))
        for (const step of extendsChain(root, file, byName))
          add(step.file, dir);
      if (adapters.includes("vitest") && VITEST.test(entry))
        for (const target of vitestImports(root, file)) add(target, dir);
    }
  }
  return readers;
}
