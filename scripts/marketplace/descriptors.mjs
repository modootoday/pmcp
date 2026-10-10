import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readCatalog } from "../library-skills/catalog.mjs";
import { readManualLibrarySkills } from "../library-skills/manual.mjs";
import { readSkillFiles } from "../library-skills/source.mjs";
import {
  canonicalSkillDirectory,
  libraryPluginId,
} from "../library-skills/layout.mjs";

export function marketplaceDescriptors(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const catalog = readCatalog(root);
  const core = {
    id: "pmcp",
    description:
      "Find package skills and use native runtime project configuration.",
    version: manifest.version,
    directory: join(root, "plugins/pmcp/skills/package-skill-catalog"),
    bridge: true,
  };
  const libraries = catalog.entries.map((entry) => ({
    id: libraryPluginId(entry.productId, entry.line.major),
    description: entry.summary,
    version: entry.delivery.version,
    directory: canonicalSkillDirectory(root, entry.productId, entry.line.major),
    bridge: false,
  }));
  const manual = readManualLibrarySkills(root, catalog).map((pilot) => {
    const [productId, major] = pilot.identity.split("/");
    return {
      id: libraryPluginId(productId, Number(major)),
      description: readSkillFiles(
        canonicalSkillDirectory(root, productId, Number(major)),
      ).skill.description,
      version: "1.0.0",
      directory: canonicalSkillDirectory(root, productId, Number(major)),
      bridge: false,
    };
  });
  const descriptors = [core, ...libraries, ...manual].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (new Set(descriptors.map((item) => item.id)).size !== descriptors.length)
    throw new Error("Duplicate public plugin identity");
  return { descriptors };
}
