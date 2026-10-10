import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs, type CommandContext } from "../src/cli/command.js";
import { readCatalog } from "../src/catalog.js";
import { CATALOG_OPTIONS, catalogOptionsFrom } from "../src/commands/roots.js";
import { publicMarketplaceRoot } from "../src/marketplace/builtin.js";
import {
  exportPublicPlugin,
  NATIVE_PLUGIN_RUNTIMES,
  pluginExportFiles,
  publicPlugins,
} from "../src/marketplace/export.js";
import { readLocalMarketplace } from "../src/marketplace/local.js";

const roots: string[] = [];
const publicRoot = publicMarketplaceRoot();
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-native-marketplace-"));
  roots.push(root);
  return root;
}
function write(root: string, path: string, value: unknown): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(
    join(root, path),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}
function context(root: string, flags: string[] = []): CommandContext {
  return {
    cwd: root,
    env: {},
    ui: {} as CommandContext["ui"],
    args: parseArgs(flags, CATALOG_OPTIONS),
  };
}

describe("built-in public marketplace", () => {
  it("ships native core manifests at the npm package root", () => {
    for (const path of [
      "plugin.json",
      ".claude-plugin/plugin.json",
      "gemini-extension.json",
    ])
      expect(
        JSON.parse(readFileSync(join(publicRoot, path), "utf8")).name,
      ).toBe("pmcp");
    expect(
      JSON.parse(readFileSync(join(publicRoot, "mcp.json"), "utf8")).mcpServers
        .pmcp.args,
    ).toEqual(["-y", "@modootoday/pmcp@0.13.1", "serve"]);
  });
  it("is CLI-only by default and preserves explicit library catalog selection", () => {
    const root = temporary();
    expect(catalogOptionsFrom(context(root)).marketplaces).toEqual([
      publicRoot,
    ]);
    expect(readCatalog({ roots: [join(root, "node_modules")] })).toEqual([]);
    const plugins = publicPlugins(publicRoot);
    expect(plugins).toHaveLength(136);
    expect(plugins.map((plugin) => plugin.name)).toContain("typescript-5");
    expect(
      readCatalog({ roots: [], marketplaces: [publicRoot] }).filter(
        (entry) => entry.kind === undefined || entry.kind === "skill",
      ),
    ).toHaveLength(136);
  });
  it("opts out through either flags or canonical configuration", () => {
    const root = temporary();
    expect(
      catalogOptionsFrom(context(root, ["--no-builtin"])).marketplaces,
    ).toBeUndefined();
    write(root, "pmcp.toml", "[catalog]\nbuiltin = false\n");
    expect(catalogOptionsFrom(context(root)).marketplaces).toBeUndefined();
  });
  it("keeps every public canonical skill equal to its human download projection", () => {
    const catalog = JSON.parse(
      readFileSync(join(publicRoot, "docs/catalog.json"), "utf8"),
    );
    const plugins = publicPlugins(publicRoot);
    for (const entry of catalog.entries) {
      const plugin = plugins.find(
        (item) => item.name === `${entry.productId}-${entry.line.major}`,
      )!;
      const skill = readdirSync(join(plugin.directory, "skills"))[0]!;
      expect(
        readFileSync(join(plugin.directory, "skills", skill, "SKILL.md")),
      ).toEqual(
        readFileSync(
          join(
            publicRoot,
            "docs/skills",
            entry.productId,
            String(entry.line.major),
            "SKILL.md",
          ),
        ),
      );
      expect(
        readFileSync(
          join(
            publicRoot,
            "docs/skills",
            entry.productId,
            String(entry.line.major),
            "releases",
            `${entry.delivery.version}.tgz`,
          ),
        ),
      ).toEqual(
        readFileSync(
          join(
            publicRoot,
            "docs/skills",
            entry.productId,
            String(entry.line.major),
            "package.tgz",
          ),
        ),
      );
    }
  });
});

describe("installed local marketplace boundaries", () => {
  it("reads Codex local source objects and portable manifests without fetching", () => {
    const root = temporary();
    write(root, ".agents/plugins/marketplace.json", {
      name: "example",
      plugins: [
        {
          name: "library-2",
          source: { source: "local", path: "./plugins/library-2" },
        },
      ],
    });
    write(root, "plugins/library-2/plugin.json", {
      name: "library-2",
      description: "Library 2",
      version: "1.0.0",
    });
    write(
      root,
      "plugins/library-2/skills/library/SKILL.md",
      "---\nname: library\ndescription: Library 2\n---\nUse version 2.\n",
    );
    expect(readCatalog({ roots: [], marketplaces: [root] })[0]?.name).toBe(
      "example/library-2/library",
    );
  });
  it("supports Grok native local catalogs", () => {
    const root = temporary();
    write(root, ".grok-plugin/marketplace.json", {
      name: "example",
      plugins: [{ name: "library", source: "./library" }],
    });
    write(root, "library/.grok-plugin/plugin.json", { name: "library" });
    expect(readLocalMarketplace(root)?.plugins[0]?.name).toBe("library");
  });
  it("rejects remote descriptors, duplicate ids, parent traversal and symlink escapes", () => {
    const root = temporary();
    const outside = temporary();
    write(root, "valid/plugin.json", { name: "valid" });
    write(outside, "plugin.json", { name: "escape" });
    symlinkSync(outside, join(root, "escape"));
    write(root, ".claude-plugin/marketplace.json", {
      name: "example",
      plugins: [
        { name: "valid", source: "./valid" },
        { name: "valid", source: "./valid" },
        { name: "escape", source: "./escape" },
        {
          name: "remote",
          source: { source: "git", url: "https://example.com/plugin.git" },
        },
        { name: "parent", source: "./../outside" },
      ],
    });
    const rejected: string[] = [];
    expect(
      readLocalMarketplace(root, (entry) => rejected.push(entry.reason))
        ?.plugins,
    ).toHaveLength(1);
    expect(rejected).toHaveLength(4);
  });
});

describe("selected native plugin exports", () => {
  it.each(NATIVE_PLUGIN_RUNTIMES)(
    "exports only one standard skill and license for %s",
    (runtime) => {
      const output = join(temporary(), "selected");
      expect(
        exportPublicPlugin(publicRoot, "typescript-5", runtime, output).plugin,
      ).toBe("typescript-5");
      const files = pluginExportFiles(publicRoot, "typescript-5", runtime);
      expect(
        [...files.keys()].filter((path) => path.endsWith("/SKILL.md")),
      ).toEqual(["skills/typescript/SKILL.md"]);
      expect(files.get("LICENSE")).toEqual(
        readFileSync(join(publicRoot, "LICENSE")),
      );
      expect([...files.keys()].some((path) => path.includes("mcp"))).toBe(
        false,
      );
      expect(() =>
        exportPublicPlugin(publicRoot, "typescript-5", runtime, output),
      ).toThrow("already exists");
    },
  );
  it("uses Antigravity's own schema and MCP filename", () => {
    const files = pluginExportFiles(publicRoot, "pmcp", "agy");
    expect(JSON.parse(files.get("plugin.json")!.toString())).toEqual({
      name: "pmcp",
      description:
        "Find package skills and use native runtime project configuration.",
    });
    expect(files.has("mcp_config.json")).toBe(true);
    expect(files.has("mcp.json")).toBe(false);
    expect(
      JSON.parse(files.get("mcp_config.json")!.toString()).mcpServers.pmcp.args,
    ).toEqual(["-y", "@modootoday/pmcp@0.13.1", "serve"]);
  });
  it("rejects absent plugins before creating output", () => {
    expect(() =>
      exportPublicPlugin(
        publicRoot,
        "unknown",
        "codex",
        join(temporary(), "absent"),
      ),
    ).toThrow("No such public plugin");
  });
  it("preserves dangling destination links instead of replacing them", () => {
    const root = temporary();
    const output = join(root, "existing-link");
    symlinkSync(join(root, "absent"), output);
    expect(() =>
      exportPublicPlugin(publicRoot, "typescript-5", "codex", output),
    ).toThrow("already exists");
  });
});
