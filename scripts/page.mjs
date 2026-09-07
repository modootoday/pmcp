import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The shell every generated page is poured into.
 *
 * Shared rather than copied: two builders with their own navigation would
 * disagree the first time a link moved, and the reader would meet whichever
 * page was rebuilt last.
 */

export const escape = (value) =>
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
export const NAV = [
  ["/guide/", "Start"],
  ["/skills/", "Skills"],
  ["/pricing/", "Pricing"],
  ["/compare/", "Compare"],
  ["/authoring/", "Authoring"],
  ["/commands/", "Commands"],
];

// The ledger sits in the footer rather than the navigation. It is worth
// finding, but the navigation was already long enough to be the first thing a
// reader complained about, and the pages that need it link to it directly.
export const FOOTER_EXTRA = [
  ["/observations/", "Observations"],
  ["/install/", "Install"],
  ["/licence/", "Licence"],
];

const MARK = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M4.25 4.6v8.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            <path d="M9 7v8.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            <path d="M13.75 4.6v8.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
          </svg>`;

export function page({ path, title, description, body }) {
  const url = `https://pmcp.build${path}`;
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === path || (path.startsWith(`${href.slice(0, -1)}/`) && href !== "/guide/") ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("\n          ");
  const footer = [...NAV, ...FOOTER_EXTRA]
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
          <a href="https://www.npmjs.com/package/@modootoday/pmcp">npm</a>
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

/**
 * Writing only what changed, and refusing to write at all under `--check`.
 * The check mode is what a gate runs: a page edited by hand is a page that
 * disagrees with the data it was supposed to be derived from.
 */
export function commit(written, { root, check }) {
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
  return changed;
}
