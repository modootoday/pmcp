import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSkillFiles } from "../library-skills/source.mjs";
import { marketplaceDescriptors } from "./descriptors.mjs";
import { marketplaceManifests, pluginManifests } from "./manifests.mjs";
import { readCatalog } from "../library-skills/catalog.mjs";
import { format } from "prettier";

async function json(value) {
  return Buffer.from(
    await format(JSON.stringify(value), { parser: "json", printWidth: 80 }),
  );
}

export async function marketplaceProjections(root) {
  const { descriptors } = marketplaceDescriptors(root);
  const files = new Map();
  for (const descriptor of descriptors) {
    for (const filename of ["LICENSE", "NOTICE"])
      files.set(
        `plugins/${descriptor.id}/${filename}`,
        readFileSync(join(root, filename)),
      );
    for (const [path, value] of pluginManifests(descriptor))
      files.set(`plugins/${descriptor.id}/${path}`, await json(value));
    const { skill, files: resources } = readSkillFiles(descriptor.directory);
    if (descriptor.directory.split("/").at(-1) !== skill.name)
      throw new Error("Canonical skill folder must match its name");
    if (descriptor.bridge) {
      for (const [path, bytes] of resources) files.set(path, bytes);
      for (const [path, value] of pluginManifests(descriptor))
        files.set(path, await json(value));
      continue;
    }
    const separator = descriptor.id.lastIndexOf("-");
    const productId = descriptor.id.slice(0, separator);
    const major = descriptor.id.slice(separator + 1);
    for (const [path, bytes] of resources)
      files.set(
        `docs/skills/${productId}/${major}/${path.slice(`skills/${skill.name}/`.length)}`,
        bytes,
      );
  }
  for (const [path, value] of marketplaceManifests(descriptors))
    files.set(path, await json(value));
  for (const entry of readCatalog(root).entries) {
    const directory = `docs/skills/${entry.productId}/${entry.line.major}`;
    const archive = readFileSync(join(root, directory, "package.tgz"));
    const path = `${directory}/releases/${entry.delivery.version}.tgz`;
    if (
      existsSync(join(root, path)) &&
      !readFileSync(join(root, path)).equals(archive)
    )
      throw new Error("An immutable archive differs from its delivery");
    files.set(path, archive);
  }
  return { descriptors, files };
}

export async function applyMarketplaceProjections(root, check = false) {
  const { descriptors, files } = await marketplaceProjections(root);
  const changed = [];
  for (const [path, bytes] of files) {
    const destination = join(root, path);
    if (existsSync(destination) && readFileSync(destination).equals(bytes))
      continue;
    changed.push(path);
    if (check) continue;
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, bytes);
  }
  if (check && changed.length)
    throw new Error(`Marketplace projections differ: ${changed.join(", ")}`);
  return {
    plugins: descriptors.length,
    files: files.size,
    changed: changed.length,
  };
}
