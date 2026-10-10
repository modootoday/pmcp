#!/usr/bin/env node
/**
 * Writes the sitemap from the pages that exist.
 *
 * Kept by hand it was a list to remember to update, and one skill now emits a
 * page per line, so remembering does not scale past the first package with two
 * majors. Walking the built site cannot disagree with the built site.
 *
 * Run: node scripts/build-sitemap.mjs [--check]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const check = process.argv.includes("--check");

function routes() {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "_site" || name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "index.html") {
        const parent = relative(docs, dir);
        found.push(parent === "" ? "/" : `/${parent.split("\\").join("/")}/`);
      }
    }
  };
  walk(docs);
  return found.sort();
}

// The home page is the entry; everything else is equal. A priority that varies
// per page is a guess about what a reader wants, and this site does not know.
const priorityOf = (route) => (route === "/" ? "1.0" : "0.8");

const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes()
  .map(
    (route) => `  <url>
    <loc>https://pmcp.build${route}</loc>
    <priority>${priorityOf(route)}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

const target = join(docs, "sitemap.xml");
let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  current = "";
}
const changed = current !== body;
if (changed && !check) writeFileSync(target, body);
console.log(
  JSON.stringify({
    urls: routes().length,
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed) process.exitCode = 1;
