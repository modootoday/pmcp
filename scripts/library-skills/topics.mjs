import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function packageNames(value) {
  if (
    !Array.isArray(value) ||
    value.some(
      (name) =>
        typeof name !== "string" || !name.trim() || name !== name.trim(),
    )
  )
    throw new Error(
      "Topic package placements must be arrays of nonempty names",
    );
  return value;
}

export function validateTopics(root, catalog) {
  const path = join(root, "docs/topics.json");
  if (!existsSync(path)) return;
  const topics = JSON.parse(readFileSync(path, "utf8"));
  if (!topics || typeof topics !== "object" || !Array.isArray(topics.groups))
    throw new Error("Topic groups must be an array");
  const placed = new Set();
  const labels = new Set();
  const collections = [packageNames(topics.ungrouped)];
  for (const group of topics.groups) {
    if (
      !group ||
      typeof group !== "object" ||
      typeof group.label !== "string" ||
      !group.label.trim() ||
      labels.has(group.label)
    )
      throw new Error("Topic groups require unique nonempty labels");
    labels.add(group.label);
    collections.push(packageNames(group.packages));
  }
  for (const names of collections) {
    for (const name of names) {
      if (placed.has(name))
        throw new Error(`Duplicate topic placement: ${name}`);
      placed.add(name);
    }
  }
  for (const entry of catalog.entries) {
    for (const target of entry.targets) {
      if (!placed.has(target.packageName))
        throw new Error(
          `Catalog target has no topic placement: ${target.packageName}`,
        );
    }
  }
}
