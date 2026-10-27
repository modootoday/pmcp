import { z } from "zod";
import {
  kebab,
  requires,
  skillFrontmatter,
  skillMetadataCore,
} from "../../schema.js";

export const catalogMetadata = z.strictObject({
  ...skillMetadataCore.shape,
  level: skillMetadataCore.shape.level.unwrap(),
  domain: kebab,
  install: skillMetadataCore.shape.install.unwrap(),
  requires: requires.strict().optional(),
  // Server-side tools the skill calls, named by the catalog that serves them.
  "server-tools": z.array(z.string().min(1)).optional(),
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
