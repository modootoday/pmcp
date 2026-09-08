#!/usr/bin/env node
/**
 * Works out which group each published skill belongs in, from the target
 * package's own npm keywords.
 *
 * A flat list of forty-five rows answers "is my package here" once you can
 * filter, and never answers "what is here at all". Grouping is what answers
 * the second, and the label has to come from somewhere: taking it from the
 * package's own keywords means this project describes nobody's package for
 * them, and a package arriving tomorrow places itself.
 *
 * Run: node scripts/refresh-topics.mjs
 */
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

/** The keywords the package publishes about itself, lowercased. */
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
  // First match wins, so the map's order is the page's order and the specific
  // labels are written before the general ones.
  const group = map.groups.find((candidate) =>
    candidate.keywords.some((keyword) => own.includes(keyword)),
  );
  if (group) placed.get(group.label).push(name);
  else ungrouped.push(name);
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
