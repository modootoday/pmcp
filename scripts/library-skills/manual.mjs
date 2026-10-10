import { existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { readSkillFiles } from "./source.mjs";

export const manualLibraryDescriptors = [
  {
    ecosystem: "pypi",
    library: "pydantic",
    version: "2.13.4",
    path: "docs/skills/pydantic/2/SKILL.md",
  },
  {
    ecosystem: "crates",
    library: "serde_json",
    version: "1.0.149",
    path: "docs/skills/serde-json/1/SKILL.md",
  },
  {
    ecosystem: "go",
    library: "github.com/google/uuid",
    version: "v1.6.0",
    path: "docs/skills/google-uuid/1/SKILL.md",
  },
];

function validateDirectories(root, relativePath) {
  let directory = root;
  for (const part of dirname(relativePath).split("/")) {
    directory = join(directory, part);
    const stats = lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Manual skill directories cannot contain symlinks");
  }
}

function isInstalled(root) {
  const path = join(root, "docs/manual-library-skills.md");
  if (!existsSync(path)) return false;
  validateDirectories(root, "docs/manual-library-skills.md");
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error("Manual library guide must be a regular file");
  return true;
}

function validateIdentity(descriptor, skill, catalog) {
  const parts = descriptor.path.split("/");
  const productId = parts[2];
  if (skill.name !== productId)
    throw new Error("Manual skill name does not match its explicit path");
  for (const entry of catalog.entries) {
    if (
      entry.productId === productId ||
      entry.targets.some(
        (target) =>
          target.packageName === descriptor.library ||
          target.packageName === skill.name,
      )
    )
      throw new Error("Manual skill identity collides with the npm catalog");
  }
  const metadata = skill.metadata;
  if (
    metadata?.ecosystem !== descriptor.ecosystem ||
    metadata?.["target-identity"] !== descriptor.library ||
    metadata?.["selected-version"] !== descriptor.version ||
    metadata?.loading !== "manual"
  )
    throw new Error(
      "Manual skill metadata differs from its explicit descriptor",
    );
  return `${productId}/${parts[3]}`;
}

export function readManualLibrarySkills(root, catalog) {
  if (!isInstalled(root)) return [];
  return manualLibraryDescriptors.map((descriptor) => {
    validateDirectories(root, descriptor.path);
    const directory = join(root, dirname(descriptor.path));
    const { source, skill, files } = readSkillFiles(directory);
    const identity = validateIdentity(descriptor, skill, catalog);
    return { ...descriptor, identity, name: skill.name, source, files };
  });
}

export function manualPageResources(pilots) {
  const resources = new Map();
  for (const pilot of pilots) {
    const installPrefix = `skills/${pilot.name}/`;
    const route = `skills/${pilot.identity}/`;
    for (const [path, bytes] of pilot.files) {
      if (!path.startsWith(installPrefix))
        throw new Error("Manual resource differs from its skill install path");
      const destination = `${route}${path.slice(installPrefix.length)}`;
      if (resources.has(destination))
        throw new Error("Duplicate manual Pages resource");
      resources.set(destination, bytes);
    }
  }
  return resources;
}
