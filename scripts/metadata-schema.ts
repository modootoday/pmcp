import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import {
  skillFrontmatter,
  skillMetadataCore,
  marketplaceManifest,
  pluginManifest,
} from "../src/metadata/schema.js";
import { catalogV1 } from "../src/metadata/profiles/catalog-v1.js";
import { libraryProfile } from "../src/metadata/profiles/library.js";

mkdirSync(new URL("../schema/", import.meta.url), { recursive: true });
for (const [name, schema] of Object.entries({
  "skill-frontmatter": skillFrontmatter,
  "skill-metadata-core": skillMetadataCore,
  "marketplace-manifest": marketplaceManifest,
  "plugin-manifest": pluginManifest,
  "catalog-v1": catalogV1,
  library: libraryProfile,
})) {
  writeFileSync(
    new URL(`../schema/${name}.json`, import.meta.url),
    JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n",
  );
}
