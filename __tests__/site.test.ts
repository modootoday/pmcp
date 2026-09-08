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
    // src as well as href: a page can ask the browser for a script that is
    // not there, and a walk that only reads href would never see it.
    for (const [, raw] of html.matchAll(/(?:href|src)="(\/[^"#]*)"/gu)) {
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

it("keeps every published line reachable from the index", () => {
  // The index is where a reader finds a line at all. Read off the BUILT page's
  // hrefs rather than the catalog that produced them, because the claim that
  // matters is what the page links -- a line dropped from the listing keeps
  // its own page and its own JSON, and nothing else notices.
  const catalog = JSON.parse(
    readFileSync(join(docs, "catalog.json"), "utf8"),
  ) as { entries: { productId: string; line?: { major: number } }[] };
  const index = readFileSync(pages.get("/skills/")!, "utf8");
  const linked = new Set(
    [...index.matchAll(/href="(\/skills\/[^"]+\/\d+\/)"/gu)].map(
      ([, href]) => href!,
    ),
  );
  const expected = catalog.entries.map(
    (entry) => `/skills/${entry.productId}/${String(entry.line?.major ?? 0)}/`,
  );
  expect(expected.filter((route) => !linked.has(route))).toEqual([]);
  expect(linked.size).toBe(expected.length);

  // Once, not at least once. The index is grouped now, and a line matched by
  // two groups would be listed twice while a set of hrefs looked perfectly
  // healthy.
  const occurrences = [
    ...index.matchAll(/href="(\/skills\/[^"]+\/\d+\/)"/gu),
  ].map(([, href]) => href!);
  const twice = occurrences.filter(
    (route, at) => occurrences.indexOf(route) !== at,
  );
  expect([...new Set(twice)]).toEqual([]);
});

it("puts every published line in exactly one group", () => {
  // A group is a claim about where a skill is. A line the map places nowhere
  // must show up under everything else rather than vanish from the page while
  // its own page stays live.
  const topics = JSON.parse(
    readFileSync(join(docs, "topics.json"), "utf8"),
  ) as {
    groups: { label: string; packages: string[] }[];
    ungrouped: string[];
  };
  const catalog = JSON.parse(
    readFileSync(join(docs, "catalog.json"), "utf8"),
  ) as { entries: { targets: { packageName: string }[] }[] };

  const placed = [
    ...topics.groups.flatMap((group) => group.packages),
    ...topics.ungrouped,
  ];
  expect(placed.filter((name, at) => placed.indexOf(name) !== at)).toEqual([]);

  const targets = [
    ...new Set(
      catalog.entries.flatMap((entry) =>
        entry.targets.map((target) => target.packageName),
      ),
    ),
  ];
  expect(targets.filter((name) => !placed.includes(name))).toEqual([]);
});

it("ships the filter as a file the page can actually load", () => {
  // A sibling brand shipped this inline and its content-security-policy
  // dropped it: the control was in the DOM, invisible, and every local check
  // passed. Inline script is refused here so that cannot happen quietly.
  const index = readFileSync(pages.get("/skills/")!, "utf8");
  expect(index).toContain('src="/assets/skills-filter.js"');
  const inline = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gu)].filter(
    (match) => !match[0].includes("application/ld+json"),
  );
  expect(inline.map((match) => match[0])).toEqual([]);
});

it("renders every row without scripting, and hides the control until there is", () => {
  // The rows are the page. The control is progressive enhancement, so it is
  // emitted hidden and a plain count stands in its place.
  const index = readFileSync(pages.get("/skills/")!, "utf8");
  const rows = [...index.matchAll(/<tr>\s*<td>/gu)].length;
  expect(rows).toBeGreaterThan(1);
  expect(index).toMatch(/<input[^>]*id="skills-filter"[\s\S]*?hidden/u);
  expect(index).toContain('id="skills-count"');
});

it("serves no skill page the catalog no longer names", () => {
  // Withdrawing three skills left their pages serving 200, unlinked from the
  // index and still offering something the catalog had stopped offering. The
  // reachability check above only asks whether every entry has a page; this
  // asks the converse, which is the half that was missing.
  const catalog = JSON.parse(
    readFileSync(join(docs, "catalog.json"), "utf8"),
  ) as { entries: { productId: string; line?: { major: number } }[] };
  const expected = new Set<string>();
  for (const entry of catalog.entries) {
    expected.add(`/skills/${entry.productId}/`);
    expected.add(
      `/skills/${entry.productId}/${String(entry.line?.major ?? 0)}/`,
    );
  }
  const served = [...pages.keys()].filter(
    (route) => route.startsWith("/skills/") && route !== "/skills/",
  );
  expect(served.filter((route) => !expected.has(route))).toEqual([]);
});

it("closes every tag it opens", () => {
  // At two hundred pages a page that renders wrong is not found by looking.
  // Script and style bodies are stripped before scanning, because a walk that
  // reads them as markup finds an opening tag in `i < n` -- the blind spot the
  // sibling brand hit and fixed by writing its scripts around the check
  // instead of the check around its scripts.
  const VOID = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const broken: string[] = [];
  for (const [route, file] of pages) {
    const html = readFileSync(file, "utf8")
      .replaceAll(/<!--[\s\S]*?-->/gu, "")
      .replaceAll(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gu, "$1$2")
      .replaceAll(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gu, "$1$2");
    const stack: string[] = [];
    for (const [, closing, name, selfClosing] of html.matchAll(
      /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/gu,
    )) {
      const tag = name!.toLowerCase();
      if (VOID.has(tag) || tag === "!doctype" || selfClosing === "/") continue;
      if (closing === "/") {
        if (stack.pop() !== tag) {
          broken.push(`${route}: </${tag}> does not close what is open`);
          break;
        }
        continue;
      }
      stack.push(tag);
    }
    if (stack.length > 0)
      broken.push(`${route}: <${stack.at(-1)!}> never closed`);
  }
  expect(broken).toEqual([]);
  expect(pages.size).toBeGreaterThan(100);
});
