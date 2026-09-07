import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readInstalledDependencies } from "../src/installed.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function root(): string {
  const path = mkdtempSync(join(tmpdir(), "pmcp-installed-"));
  roots.push(path);
  return path;
}
function json(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

it("reads the installed version instead of the requested range", () => {
  const path = root();
  json(join(path, "package.json"), { dependencies: { example: "^2.0.0" } });
  json(join(path, "node_modules/example/package.json"), {
    name: "example",
    version: "2.3.4",
  });
  expect(readInstalledDependencies(path)).toEqual({
    dependencies: [
      { name: "example", requestedAs: "example", version: "2.3.4" },
    ],
    issues: [],
  });
});

it("resolves hoisted manifests without importing package code or exports", () => {
  const path = root();
  const project = join(path, "apps/client");
  json(join(project, "package.json"), { dependencies: { "@example/ui": "*" } });
  json(join(path, "node_modules/@example/ui/package.json"), {
    name: "@example/ui",
    version: "1.2.0",
    exports: { ".": "./does-not-exist.js" },
  });
  expect(readInstalledDependencies(project).dependencies[0]?.version).toBe(
    "1.2.0",
  );
});

it("reports missing packages rather than using the declared version", () => {
  const path = root();
  json(join(path, "package.json"), {
    optionalDependencies: { "pmcp-fixture-missing": "1.0.0" },
  });
  expect(readInstalledDependencies(path)).toEqual({
    dependencies: [],
    issues: [{ name: "pmcp-fixture-missing", reason: "not_installed" }],
  });
});

it("does not bypass a corrupt local manifest for a hoisted copy", () => {
  const path = root();
  const project = join(path, "client");
  json(join(project, "package.json"), { dependencies: { example: "*" } });
  json(join(path, "node_modules/example/package.json"), {
    name: "example",
    version: "1.0.0",
  });
  json(join(project, "node_modules/example/package.json"), {});
  expect(readInstalledDependencies(project)).toEqual({
    dependencies: [],
    issues: [{ name: "example", reason: "invalid_manifest" }],
  });
});

it("preserves aliases and deduplicates declarations across fields", () => {
  const path = root();
  json(join(path, "package.json"), {
    dependencies: { alias: "npm:example@1" },
    devDependencies: { alias: "npm:example@1" },
  });
  json(join(path, "node_modules/alias/package.json"), {
    name: "example",
    version: "1.0.0",
  });
  expect(readInstalledDependencies(path).dependencies).toEqual([
    { name: "example", requestedAs: "alias", version: "1.0.0" },
  ]);
});

it("rejects path-shaped names before resolving any dependency", () => {
  const path = root();
  json(join(path, "package.json"), { dependencies: { "../outside": "*" } });
  expect(() => readInstalledDependencies(path)).toThrow(
    "invalid dependency declaration",
  );
});
