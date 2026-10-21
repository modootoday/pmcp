import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { bodyOf, frontmatterObject } from "../frontmatter.js";
import { skillFindings } from "../metadata/profiles/catalog-v1.js";
import { libraryProfile } from "../metadata/profiles/library.js";
import { TIERS, type Tier } from "../metadata/schema.js";
import type { Finding, ValidationProfile } from "./types.js";

function localeFiles(skillDir: string): string[] {
  const references = join(skillDir, "references");
  if (!existsSync(references)) return [];
  return readdirSync(references).flatMap(
    (file) => /\.([a-z]{2})\.md$/u.exec(file)?.[1] ?? [],
  );
}

// The marketplace's tier wins; a standalone skill is judged by its own metadata.tier, else open.
function tierOf(front: unknown, given: string | undefined): Tier {
  const own = (front as { metadata?: { tier?: unknown } }).metadata?.tier;
  const tier = given ?? own;
  return TIERS.includes(tier as Tier) ? (tier as Tier) : "open";
}

function catalogV1(skillMd: string, tier: string | undefined): Finding[] {
  const text = readFileSync(skillMd, "utf8");
  const front = frontmatterObject(text);
  const skillDir = dirname(skillMd);
  const findings = skillFindings({
    tier: tierOf(front, tier),
    dirName: basename(skillDir),
    front,
    body: bodyOf(text),
    hasScripts: existsSync(join(skillDir, "scripts")),
    localeFiles: localeFiles(skillDir),
  });
  return findings.map((finding) => ({
    path: skillMd,
    reason: `${finding.rule}: ${finding.message}`,
    level: finding.severity === "error" ? "error" : "warning",
  }));
}

function library(skillMd: string): Finding[] {
  const front = frontmatterObject(readFileSync(skillMd, "utf8"));
  const result = libraryProfile.safeParse(front);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: skillMd,
    reason: `schema.${issue.path.join(".") || "frontmatter"}: ${issue.message}`,
    level: "error",
  }));
}

export function profileFindings(
  skillMd: string,
  profile: ValidationProfile | undefined,
  tier?: string,
): Finding[] {
  if (profile === "catalog-v1") return catalogV1(skillMd, tier);
  if (profile === "library") return library(skillMd);
  return [];
}
