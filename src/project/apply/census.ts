import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

import { splitFrontmatter } from "../frontmatter.js";
import type { Output } from "../outputs.js";
import { RULES_DIR, trackedFiles } from "../package-rules.js";
import { censusDirs } from "../plan.js";
import type { ProjectSpec } from "../spec.js";

export function undeclared(
  spec: ProjectSpec,
  outputs: readonly Output[],
): string[] {
  const declared = new Set(outputs.map((o) => o.path));
  const found: string[] = [];
  for (const dir of censusDirs(spec)) {
    const abs = join(spec.root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const path = `${dir}/${entry}`;
      if (!declared.has(path)) found.push(path);
    }
  }
  const rules = join(spec.root, RULES_DIR);
  if (spec.tools.has("grok") && existsSync(rules)) {
    for (const entry of readdirSync(rules, { withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      found.push(`${RULES_DIR}/${entry.name}`);
    }
  }
  return found.sort();
}

export function deadGlobs(root: string, outputs: readonly Output[]): string[] {
  const rules = outputs.filter(
    (o) =>
      (o.kind === "link" || o.kind === "file") &&
      o.path.startsWith(`${RULES_DIR}/`),
  );
  if (rules.length === 0) return [];
  const tracked = trackedFiles(root, true);
  if (tracked.length === 0) return [];
  const seen = new Set<string>();
  for (const file of tracked) {
    const parts = file.split("/");
    for (let i = 1; i <= parts.length; i += 1)
      seen.add(parts.slice(0, i).join("/"));
  }
  const dead: string[] = [];
  for (const rule of rules) {
    let text: string;
    if (rule.kind === "file") {
      text = rule.content;
    } else if (rule.kind === "link") {
      const abs = join(root, posix.join(posix.dirname(rule.path), rule.target));
      if (!existsSync(abs)) continue;
      text = readFileSync(abs, "utf8");
    } else {
      continue;
    }
    const paths = splitFrontmatter(text).meta["paths"];
    for (const glob of [paths ?? []].flat()) {
      if (typeof glob !== "string") continue;
      const prefix = glob.replace(/\*.*$/u, "").replace(/\/$/u, "");
      if (prefix !== "" && !seen.has(prefix))
        dead.push(`${rule.path}: ${glob}`);
    }
  }
  return dead;
}
