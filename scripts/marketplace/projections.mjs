import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { readSkillFiles } from "../library-skills/source.mjs";
import { marketplaceDescriptors } from "./descriptors.mjs";
import { marketplaceManifests, pluginManifests } from "./manifests.mjs";
import { MOD_OUTPUT, modFiles } from "./mod.mjs";
import { readCatalog } from "../library-skills/catalog.mjs";
import { format } from "prettier";

const GENERATED = ["plugins/pmcp/skills", MOD_OUTPUT];

async function json(value) {
  return Buffer.from(
    await format(JSON.stringify(value), { parser: "json", printWidth: 80 }),
  );
}

function canonicalSkill(directory) {
  const loaded = readSkillFiles(directory);
  if (directory.split("/").at(-1) !== loaded.skill.name)
    throw new Error("Canonical skill folder must match its name");
  return loaded;
}

async function bridgeFiles(root, descriptor, files) {
  for (const directory of descriptor.directories) {
    for (const [path, bytes] of canonicalSkill(directory).files)
      files.set(`plugins/${descriptor.id}/${path}`, bytes);
  }
  for (const [path, value] of pluginManifests(descriptor))
    files.set(path, await json(value));
  if (descriptor.mod)
    for (const [path, bytes] of modFiles(root)) files.set(path, bytes);
}

function libraryFiles(descriptor, files) {
  const { skill, files: resources } = canonicalSkill(descriptor.directory);
  const separator = descriptor.id.lastIndexOf("-");
  const productId = descriptor.id.slice(0, separator);
  const major = descriptor.id.slice(separator + 1);
  for (const [path, bytes] of resources)
    files.set(
      `docs/skills/${productId}/${major}/${path.slice(`skills/${skill.name}/`.length)}`,
      bytes,
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
    for (const [path, value] of pluginManifests(descriptor, { withMod: true }))
      files.set(`plugins/${descriptor.id}/${path}`, await json(value));
    if (descriptor.bridge) {
      await bridgeFiles(root, descriptor, files);
      continue;
    }
    libraryFiles(descriptor, files);
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

function listFiles(directory, found = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(path, found);
      continue;
    }
    found.push(path);
  }
  return found;
}

export function staleGenerated(root, files) {
  return GENERATED.flatMap((directory) => listFiles(join(root, directory)))
    .map((path) => relative(root, path))
    .filter((path) => !files.has(path))
    .sort();
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
  for (const path of staleGenerated(root, files)) {
    changed.push(path);
    if (!check) rmSync(join(root, path));
  }
  if (check && changed.length)
    throw new Error(`Marketplace projections differ: ${changed.join(", ")}`);
  return {
    plugins: descriptors.length,
    files: files.size,
    changed: changed.length,
  };
}
