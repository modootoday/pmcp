#!/usr/bin/env node
/**
 * Renders the published catalog into the pages a person reads.
 *
 * The input is the catalog the API serves, saved beside the pages, so a build
 * needs no network and the pages can be checked against their source. The
 * sibling brand renders its registry the same way, for the same reason: one
 * source, two surfaces, and a marketplace that needs no server.
 *
 * Run: node scripts/build-catalog-pages.mjs [--check]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const source = join(docs, "catalog.json");
const check = process.argv.includes("--check");

const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// "Catalog" is taken. On every other page of this site it means the list the
// server derives from node_modules, and skill_catalog is one of the three MCP
// tools, so the same word for the thing we sell sent a reader to the wrong
// meaning. Install folds into Start, which is where a first-time reader is
// already going.
const NAV = [
  ["/guide/", "Start"],
  ["/skills/", "Skills"],
  ["/pricing/", "Pricing"],
  ["/compare/", "Compare"],
  ["/authoring/", "Authoring"],
  ["/commands/", "Commands"],
];

const MARK = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M4.25 4.6v8.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            <path d="M9 7v8.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            <path d="M13.75 4.6v8.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
          </svg>`;

function page({ path, title, description, body }) {
  const url = `https://pmcp.build${path}`;
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === path || (path.startsWith(`${href.slice(0, -1)}/`) && href !== "/guide/") ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("\n          ");
  const footer = [...NAV, ["/install/", "Install"], ["/licence/", "Licence"]]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join("\n          ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}" />
    <link rel="canonical" href="${url}" />
    <link rel="stylesheet" href="/assets/style.css" />
    <link rel="icon" href="/assets/mark.svg" type="image/svg+xml" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="pmcp" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escape(title)}" />
    <meta property="og:description" content="${escape(description)}" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>

    <header class="site">
      <div class="wrap">
        <a class="brand" href="/">
          ${MARK}
          pmcp
        </a>
        <nav>
          ${nav}
        </nav>
      </div>
    </header>

    <main id="main" class="wrap">
${body}
    </main>

    <footer class="site">
      <div class="wrap">
        <nav>
          ${footer}
          <a href="https://www.npmjs.com/package/pmcp">npm</a>
        </nav>
        <p>
          Copyright &copy; 2026 modootoday. Licensed under the Elastic License
          2.0.
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}

const catalog = JSON.parse(readFileSync(source, "utf8"));
const entries = [...(catalog.entries ?? [])].sort((a, b) =>
  a.productId.localeCompare(b.productId),
);

const written = [];
function emit(path, html) {
  const file = join(docs, path.slice(1), "index.html");
  written.push({ file, html });
}

const targetsOf = (entry) =>
  entry.targets
    .map(
      (target) => `${target.packageName}@${target.verifiedVersions.join(", ")}`,
    )
    .join("; ");

emit(
  "/skills/",
  page({
    path: "/skills/",
    title: "Written skills — pmcp",
    description:
      "Authored skills for packages that ship none, each verified by executing its examples against the version it names.",
    body: `      <h1>Written skills</h1>
      <p>
        A skill here is written for one package and verified by running its
        examples against that package. The date and the count below are what
        the run produced, not a claim about it.
      </p>
      <p>
        Reading this page costs nothing. Installing a skill needs a
        <a href="/pricing/">subscription</a>.
      </p>
      <div class="scroll">
        <table>
          <thead>
            <tr><th>Skill</th><th>For</th><th>Verified</th></tr>
          </thead>
          <tbody>
${
  entries.length === 0
    ? `            <tr><td colspan="3">Nothing published yet.</td></tr>`
    : entries
        .map(
          (entry) =>
            `            <tr>
              <td><a href="/skills/${escape(entry.productId)}/">${escape(entry.title)}</a></td>
              <td><code>${escape(targetsOf(entry))}</code></td>
              <td>${escape(entry.evidence?.verifiedOn || "before this was recorded")}, ${escape(String(entry.evidence?.examplesExecuted ?? 0))} examples</td>
            </tr>`,
        )
        .join("\n")
}
          </tbody>
        </table>
      </div>`,
  }),
);

for (const entry of entries) {
  const preview = entry.preview;
  emit(
    `/skills/${entry.productId}/`,
    page({
      path: `/skills/${entry.productId}/`,
      title: `${entry.title} — pmcp`,
      description: entry.summary,
      body: `      <h1>${escape(entry.title)}</h1>
      <p>${escape(entry.summary)}</p>
      <dl>
        <dt>For</dt><dd><code>${escape(targetsOf(entry))}</code></dd>
        <dt>Verified</dt><dd>${escape(entry.evidence?.verifiedOn || "before this was recorded")}, ${escape(String(entry.evidence?.examplesExecuted ?? 0))} examples executed</dd>
        <dt>Package</dt><dd><code>${escape(entry.delivery.packageName)}@${escape(entry.delivery.version)}</code></dd>
      </dl>
${
  preview?.headings?.length
    ? `      <h2>What it covers</h2>
      <ul>
${preview.headings.map((heading) => `        <li>${escape(heading)}</li>`).join("\n")}
      </ul>`
    : ""
}
${
  preview?.example
    ? `      <h2>One example from this skill</h2>
      <p>
        This is the skill's own text, not a summary of it. It runs: that is what
        verifying means here.
      </p>
      <pre><code>${escape(preview.example)}</code></pre>`
    : `      <p>
        This entry was published before previews were recorded, so there is no
        sample to show. A later revision will carry one.
      </p>`
}
      <h2>Getting it</h2>
      <p>
        With a <a href="/pricing/">subscription</a>:
      </p>
      <pre><code>npx -y pmcp login
npx -y pmcp install ${escape(entry.delivery.packageName)}</code></pre>
      <p>
        It installs as a dev dependency of your project, and the
        <a href="/guide/">MCP server</a> finds it there like any other skill.
      </p>`,
    }),
  );
}

let changed = 0;
for (const { file, html } of written) {
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    current = "";
  }
  if (current === html) continue;
  changed += 1;
  if (check) {
    console.error(`out of date: ${file.slice(root.length + 1)}`);
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

console.log(
  JSON.stringify({
    entries: entries.length,
    pages: written.length,
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed > 0) process.exitCode = 1;
