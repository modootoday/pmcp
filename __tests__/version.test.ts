import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { VERSION } from "../src/commands/index.js";

/**
 * Three places state the version: the manifest, `--version`, and the version an
 * MCP host reads from `initialize`. A release that bumps some of them leaves a
 * host reporting a build that was never published, and nothing else notices.
 */
const root = join(import.meta.dirname, "..");
const published: string = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;

it("agrees with the published version everywhere it is stated", () => {
  expect(published).toMatch(/^\d+\.\d+\.\d+$/u);
  expect(VERSION).toBe(published);

  // Read as text rather than by starting a server: the string is what a host
  // is told, and this catches it whether or not that path runs in a test.
  const mcp = readFileSync(join(root, "src/mcp.ts"), "utf8");
  const declared = /version:\s*"([^"]+)"/u.exec(mcp)?.[1];
  expect(declared).toBe(published);
});
