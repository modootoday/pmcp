import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import type { Member } from "./members.js";
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

function productionSources(root: string, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  let files: string[];
  try {
    files = readdirSync(join(root, dir, "src"), { recursive: true }).map(
      String,
    );
  } catch {
    return out;
  }
  for (const file of files) {
    if (!SOURCE.test(file) || TEST.test(file)) continue;
    try {
      out.set(file, readFileSync(join(root, dir, "src", file), "utf8"));
    } catch {
      // unreadable source adds no edge
    }
  }
  return out;
}

function imports(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:from|import)\\s*\\(?\\s*["']${escaped}(/|["'])`,
    "u",
  ).test(text);
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
  root: string,
  members: readonly Member[],
): Map<string, Set<string>> {
  const byName = new Map(
    members.flatMap((m) => (m.name ? [[m.name, m.dir] as const] : [])),
  );
  const dirs = new Set(members.map((m) => m.dir));
  const deps = new Map<string, Set<string>>();
  for (const member of members) {
    const out = new Set<string>();
    const add = (name: string): void => {
      const dir = byName.get(name);
      if (dir !== undefined && dir !== member.dir) out.add(dir);
    };
    const tsconfig = readTsconfig(root, `${member.dir}/tsconfig.json`);
    for (const field of [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
    ])
      keys(member.manifest, field).forEach(add);
    const dev = keys(member.manifest, "devDependencies").filter((name) =>
      byName.has(name),
    );
    const sources = productionSources(root, member.dir);
    if (typechecksTests(tsconfig)) dev.forEach(add);
    else
      for (const name of dev)
        if ([...sources.values()].some((text) => imports(text, name)))
          add(name);
    for (const spec of extendsSpecs(tsconfig)) {
      const parts = spec.split("/");
      add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!);
    }
    for (const [file, text] of sources)
      for (const match of text.matchAll(/from\s+["'](\.\.\/[^"']*)["']/gu)) {
        const target = posix.normalize(
          posix.join(member.dir, "src", posix.dirname(file), match[1]!),
        );
        const owner = ownerOf(target, dirs);
        if (owner !== undefined && owner !== member.dir) out.add(owner);
      }
    deps.set(member.dir, out);
  }
  return deps;
}

// The given members plus every member that depends on them, transitively.
export function withConsumers(
  root: string,
  members: readonly Member[],
  selected: Iterable<string>,
): string[] {
  const consumers = new Map<string, string[]>();
  for (const [dir, deps] of dependencyEdges(root, members))
    for (const dep of deps)
      consumers.set(dep, [...(consumers.get(dep) ?? []), dir]);
  const seen = new Set(selected);
  const queue = [...seen];
  while (queue.length > 0)
    for (const next of consumers.get(queue.pop()!) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return [...seen].sort();
}
