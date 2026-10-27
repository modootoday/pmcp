import { readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) =>
  JSON.parse(readFileSync(join(root, path), "utf8"));

// The first release of each runtime dependency that carries a security fix pmcp relies on. A
// range that admits anything older lets a consumer's lockfile keep the vulnerable release:
// 0.19.5 to 0.19.7 declared ^2.3.0, so installs with an older lock stayed on server 2.3.0.
const SECURITY_FLOORS: Readonly<Record<string, string>> = {
  // Bounded tool input validation and isolated concurrent HTTP calls; server 2.4.0 pins core
  // 2.4.0, so this floor covers both packages.
  "@modelcontextprotocol/server": "2.4.0",
  "@modelcontextprotocol/core": "2.4.0",
};

it("declares no runtime dependency below its security floor", () => {
  const dependencies: Record<string, string> =
    read("package.json").dependencies;
  expect(dependencies["@modelcontextprotocol/server"]).toBeDefined();
  for (const [name, range] of Object.entries(dependencies)) {
    const floor = SECURITY_FLOORS[name];
    if (!floor) continue;
    const lowest = semver.minVersion(range)?.version;
    expect(lowest && semver.gte(lowest, floor), `${name} ${range}`).toBe(true);
  }
});

it("resolves every floored package at or above its floor", () => {
  for (const [name, floor] of Object.entries(SECURITY_FLOORS)) {
    const { version } = read(`node_modules/${name}/package.json`);
    expect(semver.gte(version, floor), `${name} ${version}`).toBe(true);
  }
});
