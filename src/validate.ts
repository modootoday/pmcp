/** Checks skill directories against the Agent Skills specification. */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { readCatalog, type CatalogOptions } from "./catalog.js";
import { frontmatterObject, specProblems } from "./frontmatter.js";

export interface Finding {
  readonly path: string;
  readonly reason: string;
  /** error: the skill is left out or breaks a MUST; warning: served anyway. */
  readonly level: "error" | "warning";
}

/** One skill directory, or the SKILL.md inside it. */
export function validateSkillDir(dir: string): Finding[] {
  const root = resolve(dir);
  const skillMd = basename(root) === "SKILL.md" ? root : join(root, "SKILL.md");
  if (!existsSync(skillMd) || !statSync(skillMd).isFile()) {
    return [{ path: root, reason: "no SKILL.md", level: "error" }];
  }
  const front = frontmatterObject(readFileSync(skillMd, "utf8"));
  const directory = basename(skillMd === root ? join(root, "..") : root);
  return specProblems(front, directory).map((reason) => ({
    path: skillMd,
    reason,
    level: "error" as const,
  }));
}

/** Every skill the catalog options reach, with what loading reported. */
export function validateCatalog(options: CatalogOptions): Finding[] {
  const findings: Finding[] = [];
  readCatalog({
    ...options,
    onReject: (r) => findings.push({ ...r, level: "error" }),
    onWarning: (w) => findings.push({ ...w, level: "warning" }),
  });
  return findings;
}
