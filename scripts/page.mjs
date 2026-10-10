import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderPage } from "./site/layout/render.mjs";

export { escape } from "./site/layout/html.mjs";
export const page = renderPage;

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
