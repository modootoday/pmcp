import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// Static hosting cannot detect missing links or drift between generated pages.
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
    // Missing script sources escape checks limited to navigation links.
    for (const [, raw] of html.matchAll(/(?:href|src)="(\/[^"#]*)"/gu)) {
      const href = new URL(raw!, "https://pmcp.build").pathname;
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
        /<header class="site-header">[\s\S]*?<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/u.exec(
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
  // Metadata checks cannot detect markup that no longer matches the stylesheet.
  const REQUIRED = [
    '<header class="site-header">',
    '<footer class="site-footer">',
    'class="site"',
    'class="wordmark"',
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
  // A declared class has no visual effect unless a stylesheet defines it.
  const css = readFileSync(join(docs, "assets/style.css"), "utf8");
  const unstyled = new Set<string>();
  for (const [, file] of pages) {
    const html = readFileSync(file, "utf8");
    for (const [, list] of html.matchAll(/class="([^"]+)"/gu)) {
      for (const name of list!.split(/\s+/u).filter(Boolean)) {
        if (name.startsWith("language-")) continue;
        if (!css.includes(`.${name}`)) unstyled.add(name);
      }
    }
  }
  expect([...unstyled].sort()).toEqual([]);
});

it("keeps the generated catalog pages in step with the catalog they came from", () => {
  // Comparing generated output catches manual edits and catalog changes without a rebuild.
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
  // Reading built links detects entries omitted by the renderer despite having their own pages.
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

  // A set of links would hide duplicate entries assigned to multiple groups.
  const occurrences = [
    ...index.matchAll(/href="(\/skills\/[^"]+\/\d+\/)"/gu),
  ].map(([, href]) => href!);
  const twice = occurrences.filter(
    (route, at) => occurrences.indexOf(route) !== at,
  );
  expect([...new Set(twice)]).toEqual([]);
});

it("puts every published line in exactly one group", () => {
  // Unmapped entries must remain discoverable even when no named group includes them.
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
  // Inline scripts can pass local checks while the deployed content security policy blocks them.
  const index = readFileSync(pages.get("/skills/")!, "utf8");
  expect(index).toMatch(/src="\/assets\/landing\/index-[A-Z0-9]+\.js"/u);
  const inline = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gu)].filter(
    (match) => !match[0].includes("application/ld+json"),
  );
  expect(inline.map((match) => match[0])).toEqual([]);
});

it("renders every row without scripting, and hides the control until there is", () => {
  // Hidden controls preserve a useful page when progressive enhancement is unavailable.
  const index = readFileSync(pages.get("/skills/")!, "utf8");
  const rows = [...index.matchAll(/<tr\b[^>]*>\s*<td>/gu)].length;
  expect(rows).toBeGreaterThan(1);
  expect(index).toMatch(/<input[^>]*id="skills-filter"[\s\S]*?hidden/u);
  expect(index).toContain('id="skills-count"');
});

it("serves no skill page the catalog no longer names", () => {
  // Checking catalog reachability alone cannot detect withdrawn pages that still serve content.
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
  // Script comparisons can resemble HTML tags, so scripts and styles must be excluded.
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
