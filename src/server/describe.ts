import { readFileSync } from "node:fs";
import { kindOf } from "../catalog.js";
import { listSkillFiles } from "../files/list.js";
import { assetRoot, readFrontmatterText } from "../marketplace.js";
import type { DescribeResponse } from "../tools/schemas.js";
import type { ToolsContext } from "./types.js";
import { flatMetadata } from "./metadata.js";
export function describeOperation(
  context: ToolsContext,
  name: string,
): DescribeResponse | null {
  const { options, catalog, byName } = context;
  const entry = byName(name);
  if (!entry) return null;
  const source = readFileSync(entry.path, "utf8");
  const listing = listSkillFiles(assetRoot(entry));
  return {
    name: entry.name,
    kind: kindOf(entry),
    package: entry.package,
    description: entry.description,
    ...(entry.tier === undefined ? {} : { tier: entry.tier }),
    metadata: flatMetadata(entry.metadata),
    frontmatter: readFrontmatterText(source),
    files: listing.files.map((file) => ({ ...file })),
    filesTruncated: listing.truncated,
  };
}
