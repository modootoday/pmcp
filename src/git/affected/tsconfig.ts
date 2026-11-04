import { posix } from "node:path";

import type { Member } from "./members.js";
import type { HeadTree } from "./tree.js";

// tsconfig files are JSONC; parse plainly first so a "//" key survives.
export function parseJsonc(text: string): Record<string, unknown> | null {
  for (const attempt of [
    text,
    text
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "")
      .replace(/,(\s*[}\]])/gu, "$1"),
  ]) {
    try {
      const value: unknown = JSON.parse(attempt);
      if (value !== null && typeof value === "object")
        return value as Record<string, unknown>;
    } catch {
      // try the stripped form
    }
  }
  return null;
}

export function readTsconfig(
  tree: HeadTree,
  file: string,
): Record<string, unknown> | null {
  const text = tree.text(file);
  return text === null ? null : parseJsonc(text);
}

export function extendsSpecs(parsed: Record<string, unknown> | null): string[] {
  const raw = parsed?.["extends"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((spec): spec is string => typeof spec === "string");
}

function packageSplit(spec: string): [string, string] {
  const parts = spec.split("/");
  const size = spec.startsWith("@") ? 2 : 1;
  return [parts.slice(0, size).join("/"), parts.slice(size).join("/")];
}

// A package specifier resolves only into a member; anything else is installed and not ours.
function packageTarget(
  tree: HeadTree,
  spec: string,
  byName: ReadonlyMap<string, Member>,
): string | null {
  const [name, sub] = packageSplit(spec);
  const member = byName.get(name);
  if (member === undefined) return null;
  const exports = member.manifest["exports"];
  const mapped =
    exports && typeof exports === "object"
      ? (exports as Record<string, unknown>)[sub ? `./${sub}` : "."]
      : undefined;
  const candidates = [
    typeof mapped === "string" ? mapped : undefined,
    sub || "tsconfig.json",
    sub ? `${sub}.json` : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const file = posix.normalize(posix.join(member.dir, candidate));
    if (tree.has(file)) return file;
  }
  return null;
}

export interface ExtendsTarget {
  readonly file: string;
  // The member a package specifier named, absent for a relative step.
  readonly owner?: string;
}

// Every file an extends chain reaches from one tsconfig, transitively.
export function extendsChain(
  tree: HeadTree,
  file: string,
  byName: ReadonlyMap<string, Member>,
  seen: Set<string> = new Set(),
): ExtendsTarget[] {
  const out: ExtendsTarget[] = [];
  for (const spec of extendsSpecs(readTsconfig(tree, file))) {
    let target: string | null;
    let owner: string | undefined;
    if (spec.startsWith(".")) {
      target = posix.normalize(posix.join(posix.dirname(file), spec));
      if (!target.endsWith(".json")) target = `${target}.json`;
    } else {
      target = packageTarget(tree, spec, byName);
      owner = byName.get(packageSplit(spec)[0])?.dir;
    }
    if (target === null || target.startsWith("..") || seen.has(target))
      continue;
    seen.add(target);
    out.push({ file: target, ...(owner ? { owner } : {}) });
    out.push(...extendsChain(tree, target, byName, seen));
  }
  return out;
}
