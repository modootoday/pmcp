import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { readCatalog, type CatalogOptions } from "./catalog.js";
import { frontmatterObject, specProblems } from "./frontmatter.js";
import { denyListFindings } from "./validate/deny-list.js";
import { profileFindings } from "./validate/profile.js";
import type { Finding, ValidationSettings } from "./validate/types.js";

export type { Finding, ValidationSettings } from "./validate/types.js";

function selected(
  skillMd: string,
  settings: ValidationSettings,
  tier?: string,
): Finding[] {
  return [
    ...profileFindings(skillMd, settings.profile, tier),
    ...denyListFindings(skillMd, settings.denyList),
  ];
}

export function validateSkillDir(
  dir: string,
  settings: ValidationSettings = {},
): Finding[] {
  const root = resolve(dir);
  const skillMd = basename(root) === "SKILL.md" ? root : join(root, "SKILL.md");
  if (!existsSync(skillMd) || !statSync(skillMd).isFile()) {
    return [{ path: root, reason: "no SKILL.md", level: "error" }];
  }
  const front = frontmatterObject(readFileSync(skillMd, "utf8"));
  const directory = basename(skillMd === root ? join(root, "..") : root);
  return [
    ...specProblems(front, directory).map((reason) => ({
      path: skillMd,
      reason,
      level: "error" as const,
    })),
    ...selected(skillMd, settings),
  ];
}

export function validateCatalog(
  options: CatalogOptions,
  settings: ValidationSettings = {},
): Finding[] {
  const findings: Finding[] = [];
  const entries = readCatalog({
    ...options,
    onReject: (r) => findings.push({ ...r, level: "error" }),
    onWarning: (w) => findings.push({ ...w, level: "warning" }),
  });
  for (const entry of entries) {
    if (entry.kind !== undefined && entry.kind !== "skill") continue;
    if (basename(entry.path) !== "SKILL.md") continue;
    findings.push(...selected(entry.path, settings, entry.tier));
  }
  return findings;
}
