import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { commit, page } from "./page.mjs";
import {
  readSkillCatalog,
  skillRoute,
  skillSource,
} from "./site/skills/catalog.mjs";
import {
  renderSkillIndex,
  renderSkillProduct,
  renderSkillLine,
} from "./site/skills/render.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const catalog = readSkillCatalog();
const pages = [
  {
    path: "/skills/",
    title: "Free package skills — PMCP",
    description:
      "Package-specific skills, free to read, download and use without login.",
    body: renderSkillIndex(catalog),
  },
];
for (const id of new Set(catalog.entries.map((entry) => entry.productId))) {
  const lines = catalog.entries.filter((entry) => entry.productId === id);
  pages.push({
    path: `/skills/${id}/`,
    title: `${lines[0].title} — PMCP`,
    description: lines[0].summary,
    body: renderSkillProduct(lines),
  });
}
for (const entry of catalog.entries) {
  const archive = readFileSync(new URL("package.tgz", skillSource(entry)));
  if (
    `sha512-${createHash("sha512").update(archive).digest("base64")}` !==
    entry.delivery.integrity
  )
    throw new Error(
      `Archive integrity differs from catalog: ${entry.productId}`,
    );
  pages.push({
    path: skillRoute(entry),
    title: `${entry.title} ${entry.line.major}.x — PMCP`,
    description: entry.summary,
    body: renderSkillLine(entry),
  });
}
const changed = commit(
  pages.map((entry) => ({
    file: join(root, "docs", entry.path, "index.html"),
    html: page(entry),
  })),
  { root, check },
);
console.log(
  JSON.stringify({
    entries: catalog.entries.length,
    pages: pages.length,
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed > 0) process.exitCode = 1;
