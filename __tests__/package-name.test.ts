import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * Nothing may tell a reader to install the bare name.
 *
 * The scoped rename replaced the patterns it went looking for and proved each
 * file grew, which says the substitutions landed and nothing about the ones
 * never written. `npm install --save-dev pmcp` survived in three places, one of
 * them the SKILL.md that ships to npm, because a flag sat where the pattern
 * expected a package.
 *
 * `pmcp` on its own is still correct in several roles -- the brand, the bin, the
 * MCP server name, the config directory -- so this looks for the name in the
 * positions where it can only mean the package.
 */
const root = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".git", "_site", "coverage"]);
const EXTENSIONS = [".md", ".html", ".ts", ".mjs", ".json", ".xml"];

function files(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (EXTENSIONS.some((ext) => name.endsWith(ext))) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

// A package manager taking a package, npx running one, an import resolving one,
// and the registry page for one. Flags may sit between the verb and the name.
const AS_PACKAGE = [
  /\b(?:npm|bun|pnpm|yarn)\s+(?:install|add|i)(?:\s+--?[\w-]+)*\s+pmcp\b/u,
  /\bnpx\s+(?:-[\w-]+\s+)*pmcp\b/u,
  /\bfrom\s+"pmcp"|\brequire\("pmcp"\)/u,
  /npmjs\.com\/package\/pmcp\b/u,
  /"args":\s*\[[^\]]*"pmcp"/u,
];

it("never names the unscoped package", () => {
  const offences: string[] = [];
  for (const file of files()) {
    for (const [index, line] of readFileSync(file, "utf8")
      .split("\n")
      .entries()) {
      // This suite states the patterns, so it necessarily contains them.
      if (file.endsWith("package-name.test.ts")) continue;
      if (AS_PACKAGE.some((pattern) => pattern.test(line))) {
        offences.push(`${relative(root, file)}:${index + 1}`);
      }
    }
  }
  expect(offences).toEqual([]);
});

it("still uses the bare name where it is not the package", () => {
  // Proves the check above is narrow rather than absent: these must survive.
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(manifest.name).toBe("@modootoday/pmcp");
  expect(Object.keys(manifest.bin)).toEqual(["pmcp"]);
  expect(readFileSync(join(root, "src/mcp.ts"), "utf8")).toContain(
    'SERVER_NAME = "pmcp"',
  );
});
