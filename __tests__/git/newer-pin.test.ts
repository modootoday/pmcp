import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import semver from "semver";

import { VERSION } from "../../src/commands/version.js";
import { Reader } from "../../src/git/config/reader.js";
import { newerPinHint } from "../../src/git/config/newer-pin.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function checkout(pin: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-newer-pin-"));
  dirs.push(dir);
  const devDependencies = pin === null ? {} : { "@modootoday/pmcp": pin };
  writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies }));
  return join(dir, "pmcp.toml");
}

describe("an unknown key in a checkout that pins a newer pmcp", () => {
  it("names the pinned version and the install that brings it", () => {
    const newer = semver.inc(VERSION, "minor")!;
    const config = checkout(newer);
    expect(
      () => new Reader(config, "git.submodules", { future_key: 1 }, ["follow"]),
    ).toThrow(
      `unknown key [git.submodules] future_key; this checkout pins @modootoday/pmcp ${newer} but runs ${VERSION}: install the pinned version`,
    );
  });

  it("adds nothing when the pin is this version, older, a range or absent", () => {
    expect(newerPinHint(checkout(VERSION))).toBe("");
    expect(newerPinHint(checkout("0.1.0"))).toBe("");
    expect(newerPinHint(checkout("^99.0.0"))).toBe("");
    expect(newerPinHint(checkout(null))).toBe("");
    expect(newerPinHint(join(tmpdir(), "no-such-dir", "pmcp.toml"))).toBe("");
  });
});
