/**
 * Links each package's path-scoped rule file into .claude/rules/<dir>/. One level
 * down because Grok Build loads every top-level .claude/rules/*.md unscoped.
 * Names already in use are kept, so moving the links renames nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, join, posix } from "node:path";

import type { Output } from "./outputs.js";
import type { PackageRulesSpec } from "./spec.js";

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export const RULES_DIR = ".claude/rules";

/** Tracked files, relative to root; empty outside a git work tree. */
export function trackedFiles(root: string, recurse = false): string[] {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "-z", ...(recurse ? ["--recurse-submodules"] : [])],
      { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 },
    );
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

export function deriveName(dir: string, strip: readonly string[]): string {
  const segments = dir.split("/");
  if (segments.length > 1 && strip.includes(segments[0] ?? "")) {
    segments.shift();
  }
  const tokens: string[] = [];
  for (const segment of segments) {
    if (segment === "packages") continue;
    for (const token of segment.split("-")) {
      if (token === tokens[tokens.length - 1]) continue;
      tokens.push(token);
    }
  }
  return tokens.join("-");
}

function linkTarget(abs: string): string | null {
  try {
    if (!lstatSync(abs).isSymbolicLink()) return null;
    return readlinkSync(abs);
  } catch {
    return null;
  }
}

/** Top-level rule links an older layout left: name -> repo-relative target. */
export function legacyLinks(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const dir = join(root, RULES_DIR);
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".md")) continue;
    const target = linkTarget(join(dir, entry));
    if (target === null || !target.startsWith("../../")) continue;
    found.set(entry.slice(0, -3), target.slice("../../".length));
  }
  return found;
}

export function packageRuleOutputs(
  root: string,
  spec: PackageRulesSpec,
  owned: ReadonlyMap<string, string>,
): Output[] {
  const suffix = `/${spec.file}`;
  const files = trackedFiles(root)
    .filter((file) => file.endsWith(suffix))
    .sort();
  const prefix = `${RULES_DIR}/${spec.dir}/`;

  // Adopt a name from the lock first, then from a top-level link to the same
  // file or to a sibling in its directory (the long-form file it replaced).
  const byTarget = new Map<string, string>();
  for (const [path, target] of owned) {
    if (!path.startsWith(prefix)) continue;
    const rel = posix.normalize(posix.join(posix.dirname(path), target));
    byTarget.set(rel, path.slice(prefix.length, -3));
  }
  const legacy = legacyLinks(root);
  const legacyByDir = new Map<string, string>();
  for (const [name, target] of legacy) {
    if (!byTarget.has(target)) byTarget.set(target, name);
    const dir = dirname(target);
    if (!legacyByDir.has(dir)) legacyByDir.set(dir, name);
  }

  const outputs: Output[] = [];
  const taken = new Map<string, string>();
  for (const file of files) {
    const pkg = file.slice(0, -suffix.length);
    const name =
      byTarget.get(file) ??
      legacyByDir.get(dirname(file)) ??
      deriveName(pkg, spec.strip);
    const other = taken.get(name);
    if (other !== undefined) {
      throw new ProjectError(
        `two packages want rule link ${prefix}${name}.md: ${other} and ${pkg}`,
      );
    }
    taken.set(name, pkg);
    outputs.push({
      kind: "link",
      path: `${prefix}${name}.md`,
      target: `../../../${file}`,
    });
  }
  return outputs;
}
