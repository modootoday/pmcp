import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// Relative imports name the emitted file (./x.js), so tools that follow them without
// TypeScript's resolver find it. The Claude mod is the exception: its loader resolves only
// extensionless imports, and scripts/marketplace/mod.mjs ships src/ui/claude plus these two
// session files into the mod as they are.
const MOD = [
  "src/ui/claude/",
  "src/sessions/format.ts",
  "src/sessions/types.ts",
];
const SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']*)["']/gmu;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

function imports(): {
  file: string;
  line: number;
  spec: string;
  mod: boolean;
}[] {
  const root = join(import.meta.dirname, "..");
  return sources(join(root, "src")).flatMap((path) => {
    const file = relative(root, path).split("\\").join("/");
    const text = readFileSync(path, "utf8");
    const mod = MOD.some((prefix) => file.startsWith(prefix));
    return [...text.matchAll(SPECIFIER)].map((match) => ({
      file,
      line: text.slice(0, match.index).split("\n").length,
      spec: match[1]!,
      mod,
    }));
  });
}

it("names the .js file in every relative import outside the Claude mod", () => {
  const bare = imports()
    .filter((i) => !i.mod && !/\.(?:js|json)$/u.test(i.spec))
    .map((i) => `${i.file}:${i.line} ${i.spec}`);
  expect(bare).toEqual([]);
});

it("keeps the Claude mod's relative imports extensionless for its loader", () => {
  const found = imports().filter((i) => i.mod);
  expect(found.length).toBeGreaterThan(0);
  const named = found
    .filter((i) => /\.[a-z]+$/u.test(i.spec))
    .map((i) => `${i.file}:${i.line} ${i.spec}`);
  expect(named).toEqual([]);
});
