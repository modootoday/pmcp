import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { VERSION } from "../src/commands/index.js";
import { SERVER_VERSION } from "../src/mcp.js";

// Hosts and users must receive the same version as the published manifest.
const root = join(import.meta.dirname, "..");
const published: string = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;

it("agrees with the published version everywhere it is stated", () => {
  expect(published).toMatch(/^\d+\.\d+\.\d+$/u);
  expect(VERSION).toBe(published);

  expect(SERVER_VERSION).toBe(published);
});
