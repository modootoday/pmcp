#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBasePath, projectHtml } from "./site/pages/paths.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");

const flag = process.argv.indexOf("--site");
const site = flag < 0 ? "https://pmcp.build" : process.argv[flag + 1];
if (!site) throw new Error("--site needs a base URL");
const basePath = normalizeBasePath(new URL(site).pathname);

function routes() {
  const found = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "_site" || name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "index.html") {
        const parent = relative(docs, dir);
        found.set(
          parent === "" ? "/" : `/${parent.split("\\").join("/")}/`,
          path,
        );
      }
    }
  };
  walk(docs);
  return found;
}

// CDN-injected scripts are reported separately from content changes.
const EXTERNAL_SCRIPT =
  /<script\b[^>]*\bsrc="https?:\/\/[^"]*"[^>]*>\s*<\/script>\n?/giu;

function withoutInjectedScripts(html) {
  const sources = [...html.matchAll(EXTERNAL_SCRIPT)]
    .map((match) => /src="([^"]*)"/u.exec(match[0])?.[1])
    .filter((source) => source !== undefined);
  return { html: html.replace(EXTERNAL_SCRIPT, ""), sources };
}

const differing = [];
const reformatted = [];
const missing = [];
const injectedBy = new Map();
let checked = 0;

for (const [route, file] of [...routes()].sort()) {
  const expected = projectHtml(readFileSync(file, "utf8"), basePath);
  let served;
  try {
    const response = await fetch(new URL(`${basePath}${route}`, site), {
      headers: { "cache-control": "no-cache", accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      missing.push({ route, status: response.status });
      continue;
    }
    served = await response.text();
  } catch (cause) {
    missing.push({ route, status: String(cause) });
    continue;
  }
  checked += 1;
  const cleaned = withoutInjectedScripts(served);
  for (const source of cleaned.sources) {
    injectedBy.set(source, (injectedBy.get(source) ?? 0) + 1);
  }
  served = cleaned.html;
  if (served === expected) continue;
  let at = 0;
  while (
    at < served.length &&
    at < expected.length &&
    served[at] === expected[at]
  )
    at += 1;
  const divergence = {
    route,
    at,
    expected: expected.slice(at, at + 90),
    served: served.slice(at, at + 90),
  };
  const squeeze = (html) => html.replace(/\s+/gu, " ").trim();
  if (squeeze(served) === squeeze(expected)) reformatted.push(divergence);
  else differing.push(divergence);
}

const report = {
  site,
  checked,
  differing,
  reformatted,
  missing,
  injected: [...injectedBy].map(([source, pages]) => ({ source, pages })),
};
console.log(JSON.stringify(report, null, 2));
if (differing.length > 0 || missing.length > 0) process.exitCode = 1;
