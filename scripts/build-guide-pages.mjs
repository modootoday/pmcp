import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commit, page } from "./page.mjs";
import { guides } from "./site/guides/catalog.mjs";
import { renderGuide } from "./site/guides/render.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const written = guides.map((guide) => ({
  file: join(root, "docs", guide.route, "index.html"),
  html: page({
    path: guide.route,
    title: `${guide.title} — pmcp`,
    description: guide.description,
    body: renderGuide(readFileSync(join(root, "docs", guide.source), "utf8")),
  }),
}));
const changed = commit(written, { root, check });
console.log(
  JSON.stringify({
    pages: written.length,
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed > 0) process.exitCode = 1;
