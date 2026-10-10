import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { documents } from "./site/docs/catalog.mjs";
import {
  readSkillCatalog,
  skillRoutes,
  skillRoute,
} from "./site/skills/catalog.mjs";
import {
  normalizeBasePath,
  projectHtml,
  projectStyles,
} from "./site/pages/paths.mjs";
import { notFound } from "./site/pages/not-found.mjs";
import { skillResources } from "./site/skills/sources.mjs";
import {
  manualPageResources,
  readManualLibrarySkills,
} from "./library-skills/manual.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--base-path"))
  throw new Error("Usage: node scripts/prepare-pages.mjs [--base-path /pmcp]");
const basePath = normalizeBasePath(args[1] ?? "");
const catalog = readSkillCatalog();
const manualPilots = readManualLibrarySkills(root, catalog);
const manualResources = manualPageResources(manualPilots);
const output = join(root, ".release/pages");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const routes = [
  "/",
  "/examples/",
  "/observations/",
  ...skillRoutes(catalog.entries),
  ...documents.map((document) => document.route),
];
for (const route of routes) {
  const file = join("docs", route, "index.html");
  const destination = join(output, route, "index.html");
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(
    destination,
    projectHtml(readFileSync(join(root, file), "utf8"), basePath),
  );
}

for (const entry of catalog.entries) {
  const route = skillRoute(entry);
  for (const name of skillResources(join(root, "docs", route))) {
    mkdirSync(join(output, route, name, ".."), { recursive: true });
    copyFileSync(join(root, "docs", route, name), join(output, route, name));
  }
}
for (const [path, bytes] of manualResources) {
  const destination = join(output, path);
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(destination, bytes);
}
for (const name of ["catalog.json", "observations.json", "topics.json"])
  copyFileSync(join(root, "docs", name), join(output, name));

function copyAssets(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) {
    const file = join(source, name);
    const entry = lstatSync(file);
    if (entry.isSymbolicLink())
      throw new Error(`Pages assets cannot contain links: ${file}`);
    if (entry.isDirectory()) {
      copyAssets(file, join(destination, name));
      continue;
    }
    if (!/\.(?:css|js|json|svg|ttf|txt|png|webp|woff2)$/u.test(name))
      throw new Error(`Unsupported site asset: ${name}`);
    if (extname(name) === ".css") {
      writeFileSync(
        join(destination, name),
        projectStyles(readFileSync(file, "utf8"), basePath),
      );
      continue;
    }
    copyFileSync(file, join(destination, name));
  }
}
copyAssets(join(root, "docs/assets"), join(output, "assets"));
copyFileSync(
  join(root, "scripts/site/pages/legacy-redirect.js"),
  join(output, "assets/legacy-redirect.js"),
);
writeFileSync(join(output, "404.html"), notFound(basePath));
writeFileSync(join(output, ".nojekyll"), "");
writeFileSync(
  join(output, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://pmcp.build/sitemap.xml\n",
);
copyFileSync(join(root, "docs/sitemap.xml"), join(output, "sitemap.xml"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
writeFileSync(
  join(output, "build.json"),
  `${JSON.stringify({ sourceRevision, packageVersion: manifest.version, basePath }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    output: ".release/pages",
    pages: routes.length,
    basePath,
    sourceRevision,
  }),
);
