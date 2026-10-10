/**
 * The shapes the tools answer with, defined once: the TypeScript types are
 * inferred from these schemas and the same schemas are each tool's outputSchema,
 * so structuredContent cannot drift from what a client validates it against.
 */

import { z } from "zod";

import { ASSET_KINDS } from "../catalog.js";
import { RUNTIMES } from "../runtime.js";

const kind = z.enum(ASSET_KINDS);

export const runtimeSchema = z.enum(RUNTIMES);

// Open objects: a client that cached an older outputSchema must keep accepting answers
// that gain a field, so additions never break a session that has not re-listed tools.
export const catalogItemSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  tier: z.string().optional(),
  kind: kind.optional(),
  verifiedRuntimes: z.array(runtimeSchema).optional(),
  verified: z.boolean().optional(),
});

export const catalogResponseSchema = z.looseObject({
  count: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
  hasNext: z.boolean(),
  packages: z.array(
    z.looseObject({ package: z.string(), skills: z.array(catalogItemSchema) }),
  ),
});

export const findResultSchema = z.looseObject({
  ranking: z.enum(["semantic", "lexical"]),
  runtime: runtimeSchema.nullable().optional(),
  matches: z.array(
    z.looseObject({
      name: z.string(),
      package: z.string(),
      description: z.string(),
      score: z.number(),
      verifiedRuntimes: z.array(runtimeSchema).optional(),
      verified: z.boolean().optional(),
    }),
  ),
});

const skillFileSchema = z.looseObject({
  path: z.string(),
  bytes: z.number().int(),
  sha256: z.string(),
});

export const describeResponseSchema = z.looseObject({
  name: z.string(),
  kind,
  package: z.string(),
  description: z.string(),
  tier: z.string().optional(),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string()).readonly()]),
  ),
  frontmatter: z.string(),
  files: z.array(skillFileSchema),
  filesTruncated: z.boolean(),
});

export const bundleResponseSchema = z.looseObject({
  name: z.string(),
  truncated: z.boolean(),
  files: z.array(
    skillFileSchema.extend({ uri: z.string(), mimeType: z.string() }),
  ),
});

export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
export type FindResponse = z.infer<typeof findResultSchema>;
export type DescribeResponse = z.infer<typeof describeResponseSchema>;
export type BundleResponse = z.infer<typeof bundleResponseSchema>;
