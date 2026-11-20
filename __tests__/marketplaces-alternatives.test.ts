import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseArgs, type CommandContext } from "../src/cli/command.js";
import { readCatalog } from "../src/catalog.js";
import {
  CATALOG_OPTIONS,
  catalogFrom,
  catalogOptionsFrom,
  configFrom,
  rootsCommand,
} from "../src/commands/roots.js";
import { jsonOption } from "../src/commands/options/common.js";
import {
  marketplaceDoctor,
  marketplaceOutputs,
} from "../src/project/marketplaces.js";
import { readSpec, resolveMarketplaceEntry } from "../src/project/spec.js";
import { ConfigError } from "../src/config.js";

const roots: string[] = [];

afterEach(() => {
  for (const item of roots.splice(0)) {
    rmSync(item, { recursive: true, force: true });
  }
});

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-marketplaces-alt-"));
  roots.push(root);
  return root;
}

function write(path: string, contents: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function createMarketplace(dir: string, name: string, plugins: string[]): void {
  write(
    join(dir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name,
      plugins: plugins.map((plugin) => ({
        name: plugin,
        source: `./plugins/${plugin}`,
      })),
    }),
  );
  for (const plugin of plugins) {
    write(
      join(dir, "plugins", plugin, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: plugin, version: "1.0.0" }),
    );
    const skillDir = join(dir, "plugins", plugin, "skills", `${plugin}-skill`);
    mkdirSync(skillDir, { recursive: true });
    write(
      join(skillDir, "SKILL.md"),
      `---\nname: ${plugin}-skill\ndescription: Skill for ${plugin}\n---\n\n# ${plugin}\n`,
    );
  }
}

interface TestContext {
  context: CommandContext;
  data: string[];
  lines: string[];
}

function testContext(root: string, flags: string[] = []): TestContext {
  const data: string[] = [];
  const lines: string[] = [];
  const context: CommandContext = {
    cwd: root,
    env: {},
    ui: {
      data: (msg: string) => data.push(msg),
      line: (msg: string) => lines.push(msg),
      error: () => {},
      warn: () => {},
      info: () => {},
      success: () => {},
    } as unknown as CommandContext["ui"],
    args: parseArgs(flags, [...CATALOG_OPTIONS, jsonOption]),
  };
  return { context, data, lines };
}

describe("marketplaces alternatives", () => {
  it("keeps plain string entry unchanged", () => {
    const root = temporary();
    const market = join(root, "vendor/marketplace");
    createMarketplace(market, "vendor-market", ["core-tools"]);

    write(
      join(root, "pmcp.toml"),
      '[targets]\ntools = ["claude"]\n\n[catalog]\nbuiltin = false\nmarketplaces = ["vendor/marketplace"]\n',
    );

    const { context } = testContext(root);
    const options = catalogOptionsFrom(context);
    expect(options.marketplaces).toEqual([market]);

    const skills = catalogFrom(context);
    expect(skills.map((s) => s.name)).toContain(
      "vendor-market/core-tools/core-tools-skill",
    );

    const cfg = configFrom(context)!;
    const spec = readSpec(cfg);
    expect(spec.chosenMarketplaces).toHaveLength(1);
    expect(spec.chosenMarketplaces![0]).toEqual({
      original: "vendor/marketplace",
      chosen: market,
      allTried: [market],
      found: true,
      isAlternative: false,
    });

    const outputs = marketplaceOutputs(spec);
    expect(outputs).toEqual([]);
  });

  it("selects first alternative when present and skips remaining", () => {
    const root = temporary();
    const alt1 = join(root, "packages/marketplace-family/public");
    const alt2 = join(root, "packages/marketplace");
    createMarketplace(alt1, "family-public", ["family-tool"]);

    write(
      join(root, "pmcp.toml"),
      '[catalog]\nbuiltin = false\nmarketplaces = [["packages/marketplace-family/public", "packages/marketplace"]]\n',
    );

    const { context } = testContext(root);
    const options = catalogOptionsFrom(context);
    expect(options.marketplaces).toEqual([alt1]);

    const skills = catalogFrom(context);
    expect(skills.map((s) => s.name)).toContain(
      "family-public/family-tool/family-tool-skill",
    );

    const cfg = configFrom(context)!;
    const spec = readSpec(cfg);
    expect(spec.chosenMarketplaces).toHaveLength(1);
    expect(spec.chosenMarketplaces![0]!.chosen).toBe(alt1);
    expect(spec.chosenMarketplaces![0]!.found).toBe(true);
    expect(spec.chosenMarketplaces![0]!.isAlternative).toBe(true);
  });

  it("falls back to second alternative when first is absent", () => {
    const root = temporary();
    const alt1 = join(root, "packages/marketplace-family/public");
    const alt2 = join(root, "packages/marketplace");
    mkdirSync(alt1, { recursive: true });
    createMarketplace(alt2, "legacy-market", ["legacy-tool"]);

    write(
      join(root, "pmcp.toml"),
      '[catalog]\nbuiltin = false\nmarketplaces = [["packages/marketplace-family/public", "packages/marketplace"]]\n',
    );

    const { context } = testContext(root);
    const options = catalogOptionsFrom(context);
    expect(options.marketplaces).toEqual([alt2]);

    const skills = catalogFrom(context);
    expect(skills.map((s) => s.name)).toContain(
      "legacy-market/legacy-tool/legacy-tool-skill",
    );

    const cfg = configFrom(context)!;
    const spec = readSpec(cfg);
    expect(spec.chosenMarketplaces).toHaveLength(1);
    expect(spec.chosenMarketplaces![0]!.chosen).toBe(alt2);
    expect(spec.chosenMarketplaces![0]!.found).toBe(true);
  });

  it("reports rejection naming both paths when neither alternative is present", () => {
    const root = temporary();
    const alt1 = join(root, "packages/absent-1");
    const alt2 = join(root, "packages/absent-2");

    write(
      join(root, "pmcp.toml"),
      '[catalog]\nbuiltin = false\nmarketplaces = [["packages/absent-1", "packages/absent-2"]]\n',
    );

    const { context } = testContext(root);
    const rejections: { path: string; reason: string }[] = [];
    catalogFrom(context, (r) => rejections.push(r));

    expect(rejections.length).toBeGreaterThanOrEqual(1);
    expect(rejections[0]!.reason).toBe(
      "No supported native marketplace.json found",
    );
    const paths = rejections.map((r) => r.path).join(" ");
    expect(paths).toContain(alt1);
    expect(paths).toContain(alt2);
  });

  it("prevents duplicate plugins when both alternatives exist", () => {
    const root = temporary();
    const alt1 = join(root, "packages/marketplace-family/public");
    const alt2 = join(root, "packages/marketplace");
    createMarketplace(alt1, "family-public", ["shared-plugin"]);
    createMarketplace(alt2, "legacy-market", ["shared-plugin"]);

    write(
      join(root, "pmcp.toml"),
      '[catalog]\nbuiltin = false\nmarketplaces = [["packages/marketplace-family/public", "packages/marketplace"]]\n',
    );

    const { context } = testContext(root);
    const options = catalogOptionsFrom(context);
    expect(options.marketplaces).toEqual([alt1]);

    const skills = catalogFrom(context);
    const matches = skills.filter((s) =>
      s.name.endsWith("/shared-plugin-skill"),
    );
    expect(matches).toHaveLength(1);
  });

  it("names the chosen path in doctor and roots JSON output", () => {
    const root = temporary();
    const alt1 = join(root, "packages/marketplace-family/public");
    const alt2 = join(root, "packages/marketplace");
    createMarketplace(alt1, "family-public", ["plugin-x"]);

    write(
      join(root, "pmcp.toml"),
      '[targets]\ntools = ["claude", "codex"]\n\n[catalog]\nbuiltin = false\nmarketplaces = [["packages/marketplace-family/public", "packages/marketplace"]]\n',
    );

    const { context, data } = testContext(root, ["--json"]);
    const code = rootsCommand.run(context);
    expect(code).toBe(0);
    expect(data).toHaveLength(1);
    const rootsJson = JSON.parse(data[0]!);
    expect(rootsJson.marketplaces).toEqual([alt1]);

    const cfg = configFrom(context)!;
    const spec = readSpec(cfg);
    const runner = () => ({ missing: true, stdout: "", stderr: "", status: 0 });
    const findings = marketplaceDoctor(spec, runner);
    const match = findings.find((f) => f.detail === alt1);
    expect(match).toBeDefined();
    expect(match?.status).toBe("ok");
  });

  it("validates PATH_KEYS for invalid alternative entries", () => {
    const root = temporary();
    expect(() =>
      resolveMarketplaceEntry(
        [123 as unknown as string],
        root,
        join(root, "pmcp.toml"),
      ),
    ).toThrow(ConfigError);
    expect(() =>
      resolveMarketplaceEntry([], root, join(root, "pmcp.toml")),
    ).toThrow(ConfigError);
  });

  it("supports cli --marketplace override with alternatives resolution", () => {
    const root = temporary();
    const alt = join(root, "custom-market");
    createMarketplace(alt, "custom", ["custom-tool"]);

    const { context } = testContext(root, [
      "--marketplace",
      alt,
      "--no-builtin",
    ]);
    const options = catalogOptionsFrom(context);
    expect(options.marketplaces).toEqual([alt]);

    const skills = catalogFrom(context);
    expect(skills.map((s) => s.name)).toContain(
      "custom/custom-tool/custom-tool-skill",
    );
  });
});
