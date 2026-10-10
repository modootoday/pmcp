import { readFileSync } from "node:fs";
import { validateSkillDisplayTitles } from "../../library-skills/display.mjs";

const root = new URL("../../../", import.meta.url);

export function readSkillCatalog() {
  const catalog = JSON.parse(
    readFileSync(new URL("docs/catalog.json", root), "utf8"),
  );
  validateSkillDisplayTitles(catalog.entries);
  const identities = new Set();
  for (const entry of catalog.entries) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/u.test(entry.productId) ||
      !Number.isSafeInteger(entry.line?.major) ||
      entry.line.major < 0
    )
      throw new Error("Invalid public skill identity");
    const identity = skillRoute(entry);
    if (identities.has(identity))
      throw new Error(`Duplicate skill route: ${identity}`);
    identities.add(identity);
  }
  return {
    ...catalog,
    entries: [...catalog.entries].sort(
      (a, b) =>
        a.productId.localeCompare(b.productId) || b.line.major - a.line.major,
    ),
  };
}

export function skillRoute(entry) {
  return `/skills/${entry.productId}/${entry.line.major}/`;
}

export function skillRoutes(entries) {
  return [
    "/skills/",
    ...new Set(entries.map((entry) => `/skills/${entry.productId}/`)),
    ...entries.map(skillRoute),
  ];
}

export function skillSource(entry) {
  return new URL(`docs${skillRoute(entry)}SKILL.md`, root);
}

export function targets(entry) {
  return entry.targets
    .map(
      (target) => `${target.packageName}@${target.verifiedVersions.join(", ")}`,
    )
    .join("; ");
}
