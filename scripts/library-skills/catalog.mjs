import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCatalog } from "../../src/remote/catalog.ts";
import { canonicalSkillDirectory, hasCanonicalSkills } from "./layout.mjs";

export function validateCatalog(catalog) {
  const parsed = parseCatalog({
    schemaVersion: 1,
    requestId: "library-skills",
    catalog,
  });
  const routes = new Set();
  const deliveries = new Set();
  for (const entry of parsed.entries) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.productId) ||
      !Number.isSafeInteger(entry.line?.major)
    )
      throw new Error("Invalid public skill route");
    const route = `${entry.productId}/${entry.line.major}`;
    if (routes.has(route)) throw new Error("Duplicate public skill route");
    routes.add(route);
    const delivery = `${entry.delivery.packageName}@${entry.delivery.version}`;
    if (deliveries.has(delivery)) throw new Error("Duplicate delivery version");
    deliveries.add(delivery);
  }
  return parsed;
}

export function readCatalog(root) {
  const catalog = JSON.parse(
    readFileSync(join(root, "docs/catalog.json"), "utf8"),
  );
  validateCatalog(catalog);
  return catalog;
}

export function skillDirectory(root, entry) {
  if (hasCanonicalSkills(root))
    return canonicalSkillDirectory(root, entry.productId, entry.line.major);
  return archiveDirectory(root, entry);
}

export function archiveDirectory(root, entry) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.productId) ||
    !Number.isSafeInteger(entry.line?.major) ||
    entry.line.major < 0
  )
    throw new Error("Invalid public skill route");
  let current = root;
  for (const part of [
    "docs",
    "skills",
    entry.productId,
    String(entry.line.major),
  ]) {
    current = join(current, part);
    if (
      existsSync(current) &&
      (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink())
    )
      throw new Error("Skill directories cannot contain symlinks");
  }
  return join(root, "docs/skills", entry.productId, String(entry.line.major));
}
