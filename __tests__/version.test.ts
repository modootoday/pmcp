import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { VERSION } from "../src/commands/index.js";
import { SERVER_VERSION } from "../src/mcp.js";

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

  // The version a host is told on connect.
  expect(SERVER_VERSION).toBe(published);
});
