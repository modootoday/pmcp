import type { LockfileConfig } from "../config.js";

export interface LockfileInput {
  // A root file's text at the revision, or null when that revision lacks it.
  readonly read: (rev: string, path: string) => string | null;
  readonly base: string;
  readonly head: string;
  readonly config: LockfileConfig;
  // [git.affected.root_dependencies], when declared.
  readonly rootDependencies?: Readonly<Record<string, readonly string[]>>;
}

// A changed root dependency and the mapping that answered for it.
export interface RootDependencyHit {
  readonly name: string;
  readonly key: string;
  readonly members: readonly string[];
}

// all names why everything is selected; otherwise direct lists member directories whose
// resolution moved, before any consumer expansion, and mapped the root dependencies mapped.
export interface LockfileDelta {
  readonly all: string | null;
  readonly direct: readonly string[];
  readonly mapped?: readonly RootDependencyHit[];
  // The root workspaces globs changed (both readable): the caller compares the member sets.
  readonly workspaces?: boolean;
}

// The first key naming the dependency: the name itself, or a trailing-* prefix.
export function rootMapping(
  name: string,
  table: Readonly<Record<string, readonly string[]>>,
): RootDependencyHit | null {
  const keys = Object.keys(table);
  const key =
    keys.find((candidate) => candidate === name) ??
    keys.find((candidate) => isToolchain(name, [candidate]));
  return key === undefined ? null : { name, key, members: table[key]! };
}

export interface LockfileAdapter {
  // Root paths whose change asks this adapter.
  readonly files: readonly string[];
  delta(input: LockfileInput): LockfileDelta;
}

export function isToolchain(
  name: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*")
      ? name.startsWith(pattern.slice(0, -1))
      : name === pattern,
  );
}
