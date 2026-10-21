import { z } from "zod";
import {
  kebab,
  requires,
  skillFrontmatter,
  skillMetadataCore,
} from "../../schema.js";

export const SERVER_TOOLS = [
  "job_estimate",
  "job_submit",
  "job_status",
  "job_result",
  "job_cancel",
] as const;
export const catalogMetadata = z.strictObject({
  ...skillMetadataCore.shape,
  level: skillMetadataCore.shape.level.unwrap(),
  domain: kebab,
  install: skillMetadataCore.shape.install.unwrap(),
  requires: requires.strict().optional(),
  "server-tools": z.array(z.enum(SERVER_TOOLS)).optional(),
});
export const catalogV1 = skillFrontmatter
  .extend({
    name: kebab,
    description: z.string().min(40),
    metadata: catalogMetadata,
  })
  .meta({
    title: "Catalog skill frontmatter",
    description:
      'The SKILL.md frontmatter of a marketplace catalog skill: [catalog.validation] profile = "catalog-v1".',
  });
