import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ArgumentError,
  parseArgs,
  type CommandContext,
} from "../src/cli/command.js";
import { CATALOG_OPTIONS, catalogOptionsFrom } from "../src/commands/roots.js";
import { ConfigError, findConfig, readConfig } from "../src/config.js";

function project(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-config-"));
  writeFileSync(join(dir, "pmcp.toml"), toml);
  mkdirSync(join(dir, "packages", "alpha"), { recursive: true });
  return dir;
}

function context(cwd: string, argv: string[] = []): CommandContext {
  return {
    ui: {} as CommandContext["ui"],
    args: parseArgs(argv, CATALOG_OPTIONS),
    env: {},
    cwd,
  };
}

describe("findConfig", () => {
  it("does not inherit a parent configuration across a submodule boundary", () => {
    const dir = project("");
    const child = join(dir, "vendor/child");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(child, ".git"), "gitdir: ../../.git/modules/child\n");
    expect(findConfig(join(child, "src"))).toBeNull();
    writeFileSync(join(child, "pmcp.toml"), "");
    expect(findConfig(join(child, "src"))).toBe(join(child, "pmcp.toml"));
  });
  it("finds the nearest pmcp.toml walking up from a package", () => {
    const dir = project("");
    expect(findConfig(join(dir, "packages", "alpha"))).toBe(
      join(dir, "pmcp.toml"),
    );
  });

  it("returns null when no directory above has one", () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-none-"));
    expect(findConfig(dir)).toBeNull();
  });
});

describe("readConfig", () => {
  it("resolves catalog paths against the file's directory, not the caller's", () => {
    const dir = project(
      '[catalog]\nworkspaces = [".", "packages/*"]\nmarketplaces = ["m"]\nscopes = ["@pilot/"]\n',
    );
    const config = readConfig(join(dir, "pmcp.toml"));
    expect(config.catalog.workspaces).toEqual([dir, join(dir, "packages/*")]);
    expect(config.catalog.marketplaces).toEqual([join(dir, "m")]);
    expect(config.catalog.scopes).toEqual(["@pilot/"]);
  });

  it("keeps sections it does not interpret", () => {
    const dir = project('[targets]\ntools = ["claude"]\n');
    expect(readConfig(join(dir, "pmcp.toml")).raw["targets"]).toEqual({
      tools: ["claude"],
    });
  });

  it("rejects a misspelt catalog key instead of ignoring it", () => {
    const dir = project('[catalog]\nworkspace = ["."]\n');
    expect(() => readConfig(join(dir, "pmcp.toml"))).toThrow(ConfigError);
  });

  it("rejects a catalog value that is not a list of strings", () => {
    const dir = project('[catalog]\nroots = "node_modules"\n');
    expect(() => readConfig(join(dir, "pmcp.toml"))).toThrow(
      /list of strings/u,
    );
  });

  it("names the file when the TOML does not parse", () => {
    const dir = project("[catalog\n");
    expect(() => readConfig(join(dir, "pmcp.toml"))).toThrow(/pmcp\.toml/u);
  });
});

describe("catalogOptionsFrom", () => {
  it("takes the catalog from the nearest pmcp.toml when no flag is given", () => {
    const dir = project(
      '[catalog]\nworkspaces = ["."]\npackages = ["catalog"]\n',
    );
    const options = catalogOptionsFrom(context(join(dir, "packages", "alpha")));
    expect(options.workspaces).toEqual([dir]);
    expect(options.packages).toEqual([join(dir, "catalog")]);
    expect(options.roots).toEqual([join(dir, "node_modules")]);
  });

  it("lets a flag replace the file's list of the same kind", () => {
    const dir = project(
      '[catalog]\nworkspaces = ["."]\npackages = ["catalog"]\n',
    );
    const options = catalogOptionsFrom(
      context(dir, ["--package", "/elsewhere"]),
    );
    expect(options.packages).toEqual(["/elsewhere"]);
    expect(options.workspaces).toEqual([dir]);
  });

  it("ignores the file under --no-config", () => {
    const dir = project('[catalog]\nworkspaces = ["."]\n');
    const options = catalogOptionsFrom(context(dir, ["--no-config"]));
    expect(options.workspaces).toBeUndefined();
    expect(options.roots).toEqual([`${dir}/node_modules`]);
  });

  it("reports a broken file as a usage error", () => {
    const dir = project('[catalog]\nworkspace = ["."]\n');
    expect(() => catalogOptionsFrom(context(dir))).toThrow(ArgumentError);
  });

  it("fails when --config names a file that does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-missing-"));
    expect(() =>
      catalogOptionsFrom(context(dir, ["--config", join(dir, "nope.toml")])),
    ).toThrow(ArgumentError);
  });
});
