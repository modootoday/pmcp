import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// The bare name remains valid as a brand and executable, so only package positions are checked.
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

const AS_PACKAGE = [
  /\b(?:npm|bun|pnpm|yarn)\s+(?:install|add|i)(?:\s+--?[\w-]+)*\s+pmcp\b/u,
  /\bnpx\s+(?:-[\w-]+\s+)*pmcp\b/u,
  /\bfrom\s+"pmcp"|\brequire\("pmcp"\)/u,
  /npmjs\.com\/package\/pmcp\b/u,
  /"args":\s*\[[^\]]*"pmcp"/u,
];

// It reads every tracked text file; under a full parallel run that took over five seconds twice.
it("never names the unscoped package", { timeout: 30_000 }, () => {
  const offences: string[] = [];
  for (const file of files()) {
    for (const [index, line] of readFileSync(file, "utf8")
      .split("\n")
      .entries()) {
      // This test file contains the forbidden patterns as fixtures.
      if (file.endsWith("package-name.test.ts")) continue;
      if (AS_PACKAGE.some((pattern) => pattern.test(line))) {
        offences.push(`${relative(root, file)}:${index + 1}`);
      }
    }
  }
  expect(offences).toEqual([]);
});

it("still uses the bare name where it is not the package", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(manifest.name).toBe("@modootoday/pmcp");
  expect(Object.keys(manifest.bin)).toEqual(["pmcp"]);
  expect(readFileSync(join(root, "src/mcp.ts"), "utf8")).toContain(
    'SERVER_NAME = "pmcp"',
  );
});
