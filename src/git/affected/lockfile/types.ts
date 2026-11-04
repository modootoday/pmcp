import type { LockfileConfig } from "../config.js";

export interface LockfileInput {
  // A root file's text at the revision, or null when that revision lacks it.
  readonly read: (rev: string, path: string) => string | null;
  readonly base: string;
  readonly head: string;
  readonly config: LockfileConfig;
}

// all names why everything is selected; otherwise direct lists member directories whose
// resolution moved, before any consumer expansion.
export interface LockfileDelta {
  readonly all: string | null;
  readonly direct: readonly string[];
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
