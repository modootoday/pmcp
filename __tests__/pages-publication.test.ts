import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const output = join(root, ".release/pages");

beforeAll(() => {
  execFileSync(
    process.execPath,
    [join(root, "scripts/prepare-pages.mjs"), "--base-path", "/pmcp"],
    { encoding: "utf8" },
  );
});

it("publishes free skills and package documentation without private sources or pricing", () => {
  const names = readdirSync(output);
  for (const forbidden of [
    "pricing",
    "topic-map.json",
    "README.md",
    ".env",
    "CNAME",
  ])
    expect(names).not.toContain(forbidden);
  expect(names).toContain("examples");
  expect(names).toContain("skills");
  expect(names).toContain("observations");
  expect(names).toContain("catalog.json");
  expect(names).toContain("terminal-workspace");
  expect(existsSync(join(output, "assets/fonts/SPACE-GROTESK-OFL.txt"))).toBe(
    true,
  );
  expect(existsSync(join(output, "assets/landing/THREE-LICENSE.txt"))).toBe(
    true,
  );
});

it("keeps default Pages paths local and package canonicals on the intended domain", () => {
  const home = readFileSync(join(output, "index.html"), "utf8");
  const style = readFileSync(join(output, "assets/style.css"), "utf8");
  expect(home).toContain('href="/pmcp/guide/"');
  expect(home).toContain('data-basepath="/pmcp"');
  expect(home).toContain('href="https://pmcp.build/"');
  expect(home).toMatch(/src="\/pmcp\/assets\/landing\/index-[A-Z0-9]+\.js"/u);
  expect(style).toContain('url("/pmcp/assets/fonts/space-grotesk.ttf")');
});

it("provides working content and all eight homepage sections without JavaScript", () => {
  const home = readFileSync(join(output, "index.html"), "utf8");
  for (const section of [
    "intro",
    "journey",
    "workspace",
    "capabilities",
    "catalog-preview",
    "start-preview",
    "trust",
    "resources",
  ])
    expect(home).toContain(`id="${section}"`);
  expect(home).toContain("Find instructions that fit the task.");
  expect(home).toContain("npm install --save-dev @modootoday/pmcp");
  expect(home).not.toContain("{{");
  expect(home).not.toContain("window.openai");
});

it("shows real shipped instructions instead of unpublished demonstration skills", () => {
  const examples = readFileSync(join(output, "examples/index.html"), "utf8");
  const source = readFileSync(
    join(root, "skills/package-skill-catalog/SKILL.md"),
    "utf8",
  );
  expect(examples).toContain("package-skill-catalog");
  expect(examples).toContain(
    "Do not reach for this to hold a project&#39;s own skills.",
  );
  expect(source).toContain(
    "Do not reach for this to hold a project's own skills.",
  );
  expect(examples).not.toContain("demo/release-review");
  expect(examples).not.toContain("examples executed");
});

it("rejects path traversal before replacing a prepared Pages artifact", () => {
  const before = readFileSync(join(output, "build.json"), "utf8");
  const invalid = spawnSync(
    process.execPath,
    [join(root, "scripts/prepare-pages.mjs"), "--base-path", "/../private"],
    { encoding: "utf8" },
  );
  expect(invalid.status).not.toBe(0);
  expect(invalid.stderr).toContain("Invalid Pages base path");
  expect(readFileSync(join(output, "build.json"), "utf8")).toBe(before);
});

it("offers legacy commercial links without hosting their paid content", () => {
  const html = readFileSync(join(output, "404.html"), "utf8");
  expect(html).toContain("https://pro.pmcp.build/");
  expect(html).toContain('href="/pmcp/guide/"');
  expect(html).toContain("noindex");
  const redirect = readFileSync(
    join(output, "assets/legacy-redirect.js"),
    "utf8",
  );
  expect(redirect).toContain("target.search = location.search");
  expect(redirect).toContain("target.hash = location.hash");
  expect(redirect).not.toContain("skills|pricing");
  expect(redirect).not.toContain("observations");
});

it("makes every catalog line and its original content available without authentication", () => {
  const catalog = JSON.parse(
    readFileSync(join(output, "catalog.json"), "utf8"),
  );
  expect(catalog.entries.length).toBeGreaterThan(0);
  for (const entry of catalog.entries) {
    const directory = join(
      output,
      "skills",
      entry.productId,
      String(entry.line.major),
    );
    const html = readFileSync(join(directory, "index.html"), "utf8");
    expect(html).toContain("Complete instructions");
    expect(html).toContain("No PMCP login or subscription is required");
    expect(html).not.toContain("pmcp login");
    expect(html).not.toContain("https://pro.pmcp.build/skills");
    const archive = readFileSync(join(directory, "package.tgz"));
    expect(
      `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    ).toBe(entry.delivery.integrity);
    const files = execFileSync(
      "tar",
      ["-tzf", join(directory, "package.tgz")],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
    const sources = files.filter((path: string) => path.endsWith("/SKILL.md"));
    expect(sources).toHaveLength(1);
    const skillPath = sources[0];
    if (!skillPath) throw new Error("Archive contains no skill source");
    const source = execFileSync(
      "tar",
      ["-xOzf", join(directory, "package.tgz"), skillPath],
      { encoding: "utf8" },
    );
    expect(readFileSync(join(directory, "SKILL.md"), "utf8")).toBe(source);
    const path = skillPath.slice("package/".length);
    const digest = createHash("sha256").update(
      `${path.length}:${path}:${source.length}:${source}`,
    );
    expect(`sha256:${digest.digest("hex")}`).toBe(entry.contentDigest);
    const manifest = JSON.parse(
      execFileSync(
        "tar",
        ["-xOzf", join(directory, "package.tgz"), "package/package.json"],
        { encoding: "utf8" },
      ),
    );
    expect(manifest.name).toBe(entry.delivery.packageName);
    expect(manifest.version).toBe(entry.delivery.version);
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.dependencies).toBeUndefined();
  }
});
