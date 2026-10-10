import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { commit, page } from "./page.mjs";
import { documents } from "./site/docs/catalog.mjs";
import { shippedExamples } from "./site/examples/catalog.mjs";
import { renderExamples } from "./site/examples/render.mjs";
import { renderHome } from "./site/home/render.mjs";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);
const check = process.argv.includes("--check");
const examples = shippedExamples(rootUrl);
const entries = [
  {
    path: "/",
    title: "PMCP — your runtimes, one working system",
    description:
      "Find package skills, share configuration and coordinate native AI sessions. Keep the CLI, account and approval flow you already use.",
    kind: "home",
    body: renderHome(examples),
  },
  {
    path: "/examples/",
    title: "Skill example — PMCP",
    description:
      "Read the actual SKILL.md instructions shipped by the public PMCP package.",
    kind: "examples",
    body: renderExamples(examples),
  },
  ...documents
    .filter((document) => document.source.endsWith(".html"))
    .map((document) => ({
      path: document.route,
      title: `${document.title} — PMCP`,
      description: document.description,
      body: readFileSync(
        new URL(`site/docs/content/${document.source}`, import.meta.url),
        "utf8",
      ),
    })),
];
const written = entries.map((entry) => ({
  file: join(root, "docs", entry.path, "index.html"),
  html: page(entry),
}));
const changed = commit(written, { root, check });
console.log(
  JSON.stringify({
    pages: entries.length,
    examples: examples.length,
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed > 0) process.exitCode = 1;
