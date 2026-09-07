import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * The site is static files, so nothing at request time would notice a page
 * linking somewhere that does not exist, a page missing from the sitemap, or a
 * generated page drifting from the hand-written ones around it.
 */
const docs = join(import.meta.dirname, "../docs");

function routes(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "_site" || name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "index.html") {
        const parent = relative(docs, dir);
        found.set(
          parent === "" ? "/" : `/${parent.split("\\").join("/")}/`,
          path,
        );
      }
    }
  };
  walk(docs);
  return found;
}

const pages = routes();

it("links only to pages and assets that exist", () => {
  const broken: string[] = [];
  for (const [route, file] of pages) {
    const html = readFileSync(file, "utf8");
    for (const [, raw] of html.matchAll(/href="(\/[^"#]*)"/gu)) {
      const href = raw!;
      const last = href.slice(href.lastIndexOf("/") + 1);
      if (last.includes(".")) {
        if (!existsSync(join(docs, href.slice(1))))
          broken.push(`${route} -> ${href}`);
        continue;
      }
      const target = href.endsWith("/") ? href : `${href}/`;
      if (!pages.has(target)) broken.push(`${route} -> ${href}`);
    }
  }
  expect(broken).toEqual([]);
  expect(pages.size).toBeGreaterThan(5);
});

it("lists every page in the sitemap and nothing that is not a page", () => {
  const sitemap = readFileSync(join(docs, "sitemap.xml"), "utf8");
  const listed = new Set(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(([, url]) => url!),
  );
  const expected = new Set(
    [...pages.keys()].map((route) => `https://pmcp.build${route}`),
  );
  expect([...expected].filter((url) => !listed.has(url))).toEqual([]);
  expect([...listed].filter((url) => !expected.has(url))).toEqual([]);
});

it("gives every page the same navigation, generated or written by hand", () => {
  const navOf = (html: string) =>
    [
      ...(
        /<header class="site">[\s\S]*?<nav>([\s\S]*?)<\/nav>/u.exec(
          html,
        )?.[1] ?? ""
      ).matchAll(/href="([^"]+)"/gu),
    ].map(([, href]) => href!);
  const reference = navOf(readFileSync(pages.get("/guide/")!, "utf8"));
  expect(reference.length).toBeGreaterThan(3);
  for (const [route, file] of pages) {
    expect({ route, nav: navOf(readFileSync(file, "utf8")) }).toEqual({
      route,
      nav: reference,
    });
  }
});

it("gives every page the chrome the stylesheet is written for", () => {
  // The sibling brand shipped generated pages that emitted a bare <header>
  // while the stylesheet targets header.site, and they laid out full-bleed
  // beside every hand-written page. Every metadata check passed: none of them
  // looked at the frame. A generator and a page written by hand drift the same
  // way, and only one of them is obvious.
  const REQUIRED = [
    '<header class="site">',
    '<footer class="site">',
    'class="wrap"',
    'class="brand"',
    'class="skip"',
    '<main id="main"',
  ];
  const missing: string[] = [];
  for (const [route, file] of pages) {
    const html = readFileSync(file, "utf8");
    for (const part of REQUIRED) {
      if (!html.includes(part)) missing.push(`${route} ${part}`);
    }
  }
  expect(missing).toEqual([]);
});

it("styles every class the pages use", () => {
  // The sibling brand shipped generated pages whose markup the stylesheet had
  // no rule for, and they laid out full-bleed beside every hand-written page.
  // A class nothing styles is markup that renders as nothing.
  const css = readFileSync(join(docs, "assets/style.css"), "utf8");
  const unstyled = new Set<string>();
  for (const [, file] of pages) {
    const html = readFileSync(file, "utf8");
    for (const [, list] of html.matchAll(/class="([^"]+)"/gu)) {
      for (const name of list!.split(/\s+/u).filter(Boolean)) {
        if (!css.includes(`.${name}`)) unstyled.add(name);
      }
    }
  }
  expect([...unstyled].sort()).toEqual([]);
});

it("keeps the generated catalog pages in step with the catalog they came from", () => {
  // The generator is the only writer of these pages, so a page edited by hand
  // or a catalog updated without a rebuild both show up here.
  const result = execFileSync(
    process.execPath,
    [
      join(import.meta.dirname, "../scripts/build-catalog-pages.mjs"),
      "--check",
    ],
    { encoding: "utf8" },
  );
  expect(JSON.parse(result).changed).toBe(0);
});
