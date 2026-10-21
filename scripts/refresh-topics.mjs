#!/usr/bin/env node
// Use package-owned keywords so categorization does not invent claims about another package.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");

const map = JSON.parse(readFileSync(join(docs, "topic-map.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(docs, "catalog.json"), "utf8"));
const names = [
  ...new Set(
    (catalog.entries ?? []).flatMap((entry) =>
      entry.targets.map((target) => target.packageName),
    ),
  ),
].sort();

async function keywordsOf(name) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) {
    throw new Error(`registry answered ${String(response.status)} for ${name}`);
  }
  const body = await response.json();
  const latest = body["dist-tags"]?.latest;
  const keywords = body.versions?.[latest]?.keywords ?? body.keywords ?? [];
  return keywords.map((keyword) => String(keyword).toLowerCase());
}

const placed = new Map(map.groups.map((group) => [group.label, []]));
const ungrouped = [];
const keywords = {};

for (const name of names) {
  const own = await keywordsOf(name);
  keywords[name] = own;
  // Match specific groups first so general labels cannot hide them.
  const group = map.groups.find((candidate) =>
    candidate.keywords.some((keyword) => own.includes(keyword)),
  );
  if (group) {
    placed.get(group.label).push(name);
    continue;
  }
  ungrouped.push(name);
}

const written = `${JSON.stringify(
  {
    groups: [...placed]
      .filter(([, members]) => members.length > 0)
      .map(([label, members]) => ({ label, packages: members })),
    ungrouped,
    keywords,
  },
  null,
  2,
)}\n`;

const target = join(docs, "topics.json");
let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  current = "";
}
if (current !== written) writeFileSync(target, written);

console.log(
  JSON.stringify({
    packages: names.length,
    groups: JSON.parse(written).groups.length,
    ungrouped: ungrouped.length,
    changed: current !== written,
  }),
);
