import { readFileSync } from "node:fs";
import { containedPath } from "../marketplace/local.js";
import { readFrontmatter, type SkillEntry } from "../catalog.js";
import type { Context } from "./types.js";
import { asString } from "./_shared.js";
import { asList } from "./_shared.js";
import { readMetadata } from "./frontmatter.js";
export function markdownEntry(
  context: Context,
  path: string,
  fallbackSlug: string,
  shape: {
    kind?: "agent";
    root?: string;
    namespace?: string;
  },
): SkillEntry | null {
  let source: string;
  try {
    source = readFileSync(containedPath(context.pluginDir, path), "utf8");
  } catch {
    context.onReject?.({
      path,
      reason: "Asset is unreadable or outside the plugin root",
    });
    return null;
  }
  const front = readFrontmatter(source);
  const description = front["description"] ?? "";
  if (description === "") {
    context.onReject?.({ path, reason: "no description" });
    return null;
  }
  const metadata = readMetadata(source);
  const ownTier = asString(metadata["tier"]);
  if (
    context.tier !== undefined &&
    ownTier !== undefined &&
    ownTier !== context.tier
  ) {
    context.onReject?.({
      path,
      reason: `metadata.tier ${ownTier} in a ${context.tier} marketplace`,
    });
    return null;
  }
  const slug = front["name"] ?? fallbackSlug;
  const prefix = `${context.marketplace}/${context.plugin}`;
  return {
    name: shape.namespace
      ? `${prefix}/${shape.namespace}/${slug}`
      : `${prefix}/${slug}`,
    package: prefix,
    slug,
    description,
    path,
    tier: ownTier ?? context.tier,
    metadata,
    keywords: asList(metadata["keywords"]),
    ...(shape.kind ? { kind: shape.kind } : {}),
    ...(shape.root ? { root: shape.root } : {}),
  };
}
