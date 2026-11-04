import { posix } from "node:path";

import type { Member } from "./members.js";
import { importsName, readFacts } from "./source-facts.js";
import type { HeadTree } from "./tree.js";
import { extendsSpecs, readTsconfig } from "./tsconfig.js";

const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const TEST = /\.(?:test|spec)\./u;

function keys(manifest: Member["manifest"], field: string): string[] {
  const value = manifest[field];
  return value && typeof value === "object" ? Object.keys(value) : [];
}

// A package whose own exclude names no tests typechecks them, so its devDependencies count.
function typechecksTests(tsconfig: Record<string, unknown> | null): boolean {
  const exclude = tsconfig?.["exclude"];
  if (exclude === undefined) return false;
  const text = JSON.stringify(exclude);
  return !text.includes("test") && !text.includes("spec");
}

// Production sources under each member's src, listed once for every member.
function sourceFiles(
  tree: HeadTree,
  dirs: ReadonlySet<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const related = (link: string): boolean =>
    [...dirs].some(
      (dir) =>
        dir === link ||
        dir.startsWith(`${link}/`) ||
        link.startsWith(`${dir}/`),
    );
  for (const path of tree.files("", related)) {
    if (!SOURCE.test(path)) continue;
    for (
      let at = path.indexOf("/src/");
      at >= 0;
      at = path.indexOf("/src/", at + 1)
    ) {
      const dir = path.slice(0, at);
      if (!dirs.has(dir) || TEST.test(path.slice(at + 5))) continue;
      const list = out.get(dir) ?? [];
      list.push(path);
      out.set(dir, list);
    }
  }
  return out;
}

function ownerOf(path: string, dirs: ReadonlySet<string>): string | undefined {
  for (let cur = path; cur && cur !== "."; cur = posix.dirname(cur))
    if (dirs.has(cur)) return cur;
  return undefined;
}

// Edges a typechecked file can follow: runtime and peer dependencies, development
// dependencies its production source imports (all of them when it typechecks its tests),
// tsconfig presets a member ships, and relative imports that leave the package.
export function dependencyEdges(
  tree: HeadTree,
  members: readonly Member[],
): Map<string, Set<string>> {
  const byName = new Map(
    members.flatMap((m) => (m.name ? [[m.name, m.dir] as const] : [])),
  );
  const dirs = new Set(members.map((m) => m.dir));
  const deps = new Map<string, Set<string>>();
  const sources = sourceFiles(tree, dirs);
  const facts = readFacts(tree, [...sources.values()].flat());
  tree.prefetch(members.map((m) => `${m.dir}/tsconfig.json`));
  for (const member of members) {
    const out = new Set<string>();
    const add = (name: string): void => {
      const dir = byName.get(name);
      if (dir !== undefined && dir !== member.dir) out.add(dir);
    };
    const tsconfig = readTsconfig(tree, `${member.dir}/tsconfig.json`);
    for (const field of [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
    ])
      keys(member.manifest, field).forEach(add);
    const dev = keys(member.manifest, "devDependencies").filter((name) =>
      byName.has(name),
    );
    const files = (sources.get(member.dir) ?? []).flatMap((path) => {
      const found = facts.get(path);
      return found === undefined ? [] : [[path, found] as const];
    });
    if (typechecksTests(tsconfig)) dev.forEach(add);
    else
      for (const name of dev)
        if (files.some(([, found]) => importsName(found, name))) add(name);
    for (const spec of extendsSpecs(tsconfig)) {
      const parts = spec.split("/");
      add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!);
    }
    for (const [file, found] of files)
      for (const spec of found.parents) {
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        const owner = ownerOf(target, dirs);
        if (owner !== undefined && owner !== member.dir) out.add(owner);
      }
    deps.set(member.dir, out);
  }
  return deps;
}

// The given members plus every member that depends on them, transitively.
export function withConsumers(
  tree: HeadTree,
  members: readonly Member[],
  selected: Iterable<string>,
): string[] {
  const seen = new Set(selected);
  if (seen.size === 0) return [];
  const consumers = new Map<string, string[]>();
  for (const [dir, deps] of dependencyEdges(tree, members))
    for (const dep of deps)
      consumers.set(dep, [...(consumers.get(dep) ?? []), dir]);
  const queue = [...seen];
  while (queue.length > 0)
    for (const next of consumers.get(queue.pop()!) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return [...seen].sort();
}
