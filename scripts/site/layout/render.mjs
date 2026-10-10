import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { escape } from "./html.mjs";
import { documents } from "../docs/catalog.mjs";

const links = [
  ["/#capabilities", "Product"],
  ["/skills/", "Free skills"],
  ["/examples/", "Examples"],
  ["/guide/", "Docs"],
  ["https://github.com/modootoday/pmcp", "GitHub"],
];

function navigation(entries, path) {
  return entries
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${escape(label)}</a>`,
    )
    .join("\n");
}

function header(path) {
  return `<header class="site-header">
    <a class="wordmark" href="/" aria-label="PMCP homepage">pmcp<span>_</span></a>
    <nav aria-label="Main navigation">${navigation(links, path)}</nav>
    <a class="button header-start" href="/guide/">Get started</a>
  </header>`;
}

function footer() {
  return `<footer class="site-footer">
    <div><a class="wordmark" href="/">pmcp<span>_</span></a><p>Native tools. Shared possibilities.</p><p>Source available under Elastic License 2.0.</p></div>
    <div><strong>Learn</strong>${navigation([
      ["/guide/", "Getting started"],
      ["/project-configuration/", "Configuration"],
      ["/examples/", "Skill example"],
      ["/skills/", "Free package skills"],
    ])}</div>
    <div><strong>Build</strong>${navigation([
      ["/commands/", "CLI reference"],
      ["/terminal-harness/", "Native sessions"],
      ["/mailbox/", "Mailbox"],
      ["/authoring/", "Ship a skill"],
    ])}</div>
    <div><strong>Project</strong>${navigation([
      ["https://github.com/modootoday/pmcp", "GitHub"],
      ["https://www.npmjs.com/package/@modootoday/pmcp", "npm"],
      ["/licence/", "Licence"],
    ])}</div>
    <p class="copyright">© 2026 modootoday.</p>
  </footer>`;
}

function documentBody(path, body) {
  let title =
    documents.find((document) => document.route === path)?.title ??
    "Documentation";
  if (path.startsWith("/skills/")) title = "Free package skills";
  if (path === "/observations/") title = "Sandbox observations";
  const menu = documents.map((document) => [document.route, document.title]);
  return `<div class="docs-layout"><aside><details open><summary>Documentation</summary><nav aria-label="Documentation">${navigation(menu, path)}</nav></details></aside>
    <article class="docs-body"><p class="breadcrumb"><a href="/guide/">Docs</a> / ${escape(title)}</p>${body}</article></div>`;
}

export function renderPage({
  path,
  title,
  description,
  body,
  kind = "document",
}) {
  const hash = createHash("sha256")
    .update(
      readFileSync(new URL("../../../docs/assets/style.css", import.meta.url)),
    )
    .digest("hex")
    .slice(0, 12);
  const content = kind === "document" ? documentBody(path, body) : body;
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../docs/assets/landing/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const script =
    path === "/" || path === "/examples/" || path === "/skills/"
      ? `<script type="module" src="/assets/landing/${manifest.entry}"></script>`
      : "";
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}" />
  <link rel="canonical" href="https://pmcp.build${path}" />
  <link rel="stylesheet" href="/assets/style.css?v=${hash}" />
  <link rel="icon" href="/assets/mark.svg" type="image/svg+xml" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="PMCP" />
  <meta property="og:title" content="${escape(title)}" />
  <meta property="og:description" content="${escape(description)}" />
  <meta property="og:url" content="https://pmcp.build${path}" />
</head><body><a class="skip" href="#main">Skip to content</a>
<div id="frame"><div class="site">${header(path)}
<main id="main">${content}</main>${footer()}</div></div>${script}
</body></html>\n`;
}
