#!/usr/bin/env node
// Fetch the published catalog so pages cannot retain stale API evidence.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "docs", "catalog.json");

const flag = process.argv.indexOf("--api");
const api = flag < 0 ? "https://api.pmcp.build" : process.argv[flag + 1];
if (!api) throw new Error("--api needs a base URL");

const response = await fetch(new URL("/v1/catalog", api), {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) {
  throw new Error(`${api} answered ${response.status} for the catalog`);
}
const envelope = await response.json();
const catalog = envelope?.catalog;
if (!catalog || !Array.isArray(catalog.entries)) {
  throw new Error("the response carries no catalog");
}

// Require evidence dates so missing data cannot appear to mean verified today.
for (const entry of catalog.entries) {
  if (typeof entry.productId !== "string" || entry.productId === "") {
    throw new Error("an entry has no product id");
  }
  const executed = entry.evidence?.examplesExecuted;
  if (typeof executed !== "number" || executed < 1) {
    throw new Error(`${entry.productId} reports no executed examples`);
  }
}

const written = `${JSON.stringify(
  {
    revision: catalog.revision,
    publishedAt: catalog.publishedAt,
    entries: catalog.entries,
  },
  null,
  2,
)}\n`;

let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  current = "";
}
if (current !== written) writeFileSync(target, written);

console.log(
  JSON.stringify({
    revision: catalog.revision,
    entries: catalog.entries.length,
    changed: current !== written,
  }),
);
