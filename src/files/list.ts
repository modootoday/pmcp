/** The files one skill carries, with sizes and digests. */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { servedBytes } from "./redact.js";

export interface SkillFile {
  /** Relative to the skill directory, with forward slashes. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SkillFileListing {
  readonly files: readonly SkillFile[];
  readonly truncated: boolean;
}

/** How many files a listing holds before it says the rest were cut. */
export const FILE_LIST_LIMIT = 200;

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function describe(path: string, full: string): SkillFile {
  const bytes = servedBytes(full, readFileSync(full));
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * Every file under a skill root, or the root itself when the asset is one file.
 * node_modules and .git are never part of a skill.
 */
export function listSkillFiles(
  root: string,
  limit = FILE_LIST_LIMIT,
): SkillFileListing {
  if (statSync(root).isFile()) {
    return { files: [describe(basename(root), root)], truncated: false };
  }
  const files: SkillFile[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= limit) return { files, truncated: true };
      files.push(describe(relative(root, full).split(sep).join("/"), full));
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated: false };
}
