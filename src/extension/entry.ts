/**
 * One catalog skill as the Skills extension (SEP-2640) describes it: frontmatter
 * plus a complete manifest of its files with sha256 digests and sizes.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

import { kindOf, type SkillEntry } from "../catalog.js";
import { frontmatterObject, specProblems } from "../frontmatter.js";
import { servedBytes } from "../files/redact.js";
import { skillFileUri } from "../files/uri.js";

export const MAX_RESOURCES = 512;
export const MAX_SKILL_BYTES = 16 * 1024 * 1024;

export interface SkillResource {
  readonly uri: string;
  readonly digest: string;
  readonly size: number;
}

export interface SkillExtensionEntry {
  readonly uri: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly resources: readonly SkillResource[];
}

interface FileFacts {
  readonly key: string;
  readonly digest: string;
  readonly size: number;
}

// Shared across server instances: the HTTP handler builds one per request.
const digests = new Map<string, FileFacts>();

function facts(path: string): FileFacts {
  const stat = statSync(path);
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = digests.get(path);
  if (cached?.key === key) return cached;
  const bytes = servedBytes(path, readFileSync(path));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const fresh = { key, digest, size: bytes.length };
  digests.set(path, fresh);
  return fresh;
}

/** Every file under a skill directory, or null past the extension's file limit. */
function filesUnder(root: string): string[] | null {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) found.push(full);
      if (found.length > MAX_RESOURCES) return null;
    }
  }
  return found.sort();
}

/**
 * The extension's entry, or null when the skill cannot be served under SEP-2640:
 * not a directory with SKILL.md, frontmatter that breaks the Agent Skills
 * specification, a name unlike its path, or over the per-skill limits. Such a
 * skill stays reachable through the skill_* tools.
 */
export function extensionEntry(entry: SkillEntry): SkillExtensionEntry | null {
  if (kindOf(entry) !== "skill" || basename(entry.path) !== "SKILL.md")
    return null;
  const frontmatter = frontmatterObject(readFileSync(entry.path, "utf8"));
  const root = dirname(entry.path);
  if (specProblems(frontmatter, basename(root)).length > 0) return null;
  // The URI's last segment is the name, which also has to be the catalog slug.
  if (frontmatter?.["name"] !== entry.slug) return null;
  const files = filesUnder(root);
  if (files === null) return null;
  let total = 0;
  const resources = files.map((path) => {
    const fact = facts(path);
    total += fact.size;
    const file = relative(root, path).split(sep).join("/");
    return {
      uri: skillFileUri(entry, file),
      digest: fact.digest,
      size: fact.size,
    };
  });
  if (total > MAX_SKILL_BYTES) return null;
  return { uri: skillFileUri(entry), frontmatter: frontmatter!, resources };
}
