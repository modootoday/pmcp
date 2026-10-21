import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

interface Page {
  readonly route: string;
}
const load = async (path: string, key: string) =>
  (
    (await import(new URL(path, import.meta.url).href)) as Record<
      string,
      Page[]
    >
  )[key]!;
const documents = await load("../scripts/site/docs/catalog.mjs", "documents");
const guides = await load("../scripts/site/guides/catalog.mjs", "guides");

const root = join(import.meta.dirname, "..");
const html = (route: string) =>
  readFileSync(join(root, "docs", route, "index.html"), "utf8");

// Guide pages once rendered headings without ids, so every #fragment link into them on
// pmcp.build landed at the top of the page. Each fragment must name a heading that exists.
it("resolves every fragment link that points at a guide page", () => {
  const ids = new Map(
    guides.map((guide) => [
      guide.route,
      new Set(
        [...html(guide.route).matchAll(/ id="([^"]+)"/gu)].map((m) => m[1]),
      ),
    ]),
  );
  const broken: string[] = [];
  for (const page of documents) {
    for (const [, href] of html(page.route).matchAll(
      /href="([^"]*#[^"]*)"/gu,
    )) {
      const [path, fragment] = href!.split("#");
      const target = path === "" ? page.route : path!;
      const known = ids.get(target);
      if (known && !known.has(fragment!))
        broken.push(`${page.route} -> ${href}`);
    }
  }
  expect(broken).toEqual([]);
});
