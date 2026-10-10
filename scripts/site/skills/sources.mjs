import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

function optionalFiles(directory, pattern) {
  let names;
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names.sort().map((name) => {
    if (!pattern.test(name))
      throw new Error("Unsupported skill resource: " + name);
    const path = join(directory, name);
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error("Skill resources must be regular files: " + name);
    return name;
  });
}

export function skillResources(directory) {
  const sources = ["SKILL.md", "package.tgz"];
  for (const name of optionalFiles(
    join(directory, "references"),
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/u,
  )) {
    sources.push("references/" + name);
  }
  for (const name of optionalFiles(
    join(directory, "releases"),
    /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\.tgz$/u,
  )) {
    sources.push("releases/" + name);
  }
  return sources;
}
