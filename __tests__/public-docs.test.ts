import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { COMMANDS } from "../src/commands/index.js";

const root = join(import.meta.dirname, "..");

it("documents every public top-level command", () => {
  const html = readFileSync(join(root, "docs/commands/index.html"), "utf8");
  const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gu)].map(
    (match) => match[1]!,
  );
  const documented = headings.flatMap((heading) =>
    heading.split(/\s*[\/·]\s*/u),
  );
  expect(
    COMMANDS.map((command) => command.name).filter(
      (name) => !documented.includes(name),
    ),
  ).toEqual([]);
});

it("keeps generated human guides in step with the package Markdown", () => {
  const output = execFileSync(
    process.execPath,
    [join(root, "scripts/build-guide-pages.mjs"), "--check"],
    { encoding: "utf8" },
  );
  expect(JSON.parse(output)).toMatchObject({
    pages: 7,
    changed: 0,
    mode: "check",
  });
});

it("keeps site-only assets reproducible without adding runtime dependencies", () => {
  const output = execFileSync(
    process.execPath,
    [join(root, "scripts/build-site-assets.mjs"), "--check"],
    { encoding: "utf8" },
  );
  expect(JSON.parse(output).changed).toBe(0);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(manifest.dependencies.three).toBeUndefined();
  expect(manifest.dependencies.marked).toBeUndefined();
});

it("names every direct runtime dependency in installation and licence notices", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const file of [
    "docs/install/index.html",
    "docs/licence/index.html",
    "NOTICE",
  ]) {
    const content = readFileSync(join(root, file), "utf8");
    expect(
      Object.keys(manifest.dependencies).filter(
        (name) => !content.includes(name),
      ),
    ).toEqual([]);
  }
});

it("states terminal prerequisites and separates an illustration from live execution", () => {
  const workspace = readFileSync(
    join(root, "docs/terminal-workspace.md"),
    "utf8",
  );
  expect(workspace).toContain("PMCP 0.13.0 or later");
  const home = readFileSync(join(root, "docs/index.html"), "utf8");
  expect(home).toContain("A shared project, native sessions");
  expect(home.replace(/\s+/gu, " ")).toContain(
    "Interactive Three.js scene; no runtime is connected.",
  );
  expect(home).toMatch(/<noscript\b/u);
  expect(home).toMatch(/src="\/assets\/landing\/index-[A-Z0-9]+\.js"/u);
  expect(home).toMatch(/href="\/assets\/style\.css\?v=[a-f0-9]{12}"/u);
});
