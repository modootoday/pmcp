import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function libraryPluginId(productId, major) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(productId) ||
    !Number.isSafeInteger(major) ||
    major < 0
  )
    throw new Error("Invalid library plugin identity");
  const id = `${productId}-${major}`;
  if (id.length > 64)
    throw new Error("Library plugin name exceeds 64 characters");
  return id;
}

export function canonicalSkillDirectory(root, productId, major) {
  const plugin = libraryPluginId(productId, major);
  let directory = root;
  for (const part of ["plugins", plugin, "skills"]) {
    directory = join(directory, part);
    const stats = lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error(
        "Canonical skill directories must be regular directories",
      );
  }
  const children = readdirSync(directory, { withFileTypes: true });
  if (children.length !== 1 || !children[0].isDirectory())
    throw new Error("A library plugin requires exactly one skill directory");
  return join(directory, children[0].name);
}

export function hasCanonicalSkills(root) {
  return existsSync(join(root, "plugins/pmcp/skills"));
}
