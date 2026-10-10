import { escape } from "../layout/html.mjs";

export function notFound(basePath) {
  return `<!doctype html><html lang="en" data-basepath="${basePath}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Page moved — PMCP</title><meta name="robots" content="noindex" /><link rel="stylesheet" href="${basePath}/assets/style.css" /></head><body>
    <main class="section"><h1>Page not found.</h1><p>PMCP documentation and free package skills live here. Reading, downloading and using these skills requires no login.</p>
    <p><a href="${basePath}/guide/">Read the package docs</a> · <a href="${basePath}/skills/">Browse free skills</a> · <a href="${basePath}/">Homepage</a></p>
    <p>Commercial service pages use a separate address: <a id="moved-link" href="https://pro.pmcp.build/">PMCP Pro</a>.</p></main>
    <script type="module" src="${escape(basePath)}/assets/legacy-redirect.js"></script></body></html>\n`;
}
