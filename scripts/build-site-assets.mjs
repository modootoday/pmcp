import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commit } from "./page.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const result = await build({
  entryPoints: [join(root, "scripts/site/landing.js")],
  outdir: join(root, "docs/assets/landing"),
  entryNames: "index-[hash]",
  chunkNames: "[name]-[hash]",
  bundle: true,
  splitting: true,
  minify: true,
  format: "esm",
  target: "es2022",
  legalComments: "none",
  write: false,
});
const written = result.outputFiles.map((file) => ({
  file: file.path,
  html: file.text,
}));
const entry = result.outputFiles.find((file) =>
  basename(file.path).startsWith("index-"),
);
if (!entry) throw new Error("Missing landing entry asset");
written.push({
  file: join(root, "docs/assets/landing/manifest.json"),
  html: `${JSON.stringify({ entry: basename(entry.path) }, null, 2)}\n`,
});
written.push({
  file: join(root, "docs/assets/landing/THREE-LICENSE.txt"),
  html: readFileSync(join(root, "node_modules/three/LICENSE"), "utf8"),
});
const kept = new Set(written.map((file) => basename(file.file)));
const stale = readdirSync(join(root, "docs/assets/landing")).filter(
  (name) => !kept.has(name),
);
if (!check) {
  for (const name of stale) rmSync(join(root, "docs/assets/landing", name));
}
const changed = commit(written, { root, check }) + stale.length;
console.log(
  JSON.stringify({
    assets: written.length,
    bytes: result.outputFiles.reduce(
      (total, file) => total + file.contents.length,
      0,
    ),
    gzipBytes: result.outputFiles.reduce(
      (total, file) => total + gzipSync(file.contents).length,
      0,
    ),
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed > 0) process.exitCode = 1;
