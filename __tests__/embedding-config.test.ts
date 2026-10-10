import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArgumentError,
  parseArgs,
  type CommandContext,
} from "../src/cli/command.js";
import { EMBEDDING_OPTIONS, embeddingFrom } from "../src/commands/embedding.js";
import { modelsCommand } from "../src/commands/models.js";
import { indexCommand } from "../src/commands/reindex.js";
import { CATALOG_OPTIONS } from "../src/commands/roots.js";
import { ConfigError, readConfig } from "../src/config.js";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pmcp-embedding-config-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function context(argv: string[], cwd = directory): CommandContext {
  return {
    cwd,
    env: {},
    args: parseArgs(argv, [
      ...CATALOG_OPTIONS,
      ...EMBEDDING_OPTIONS,
      { name: "dry-run", boolean: true, describe: "" },
      { name: "json", boolean: true, describe: "" },
    ]),
    ui: {
      data: vi.fn(),
      line: vi.fn(),
      info: vi.fn(),
    } as unknown as CommandContext["ui"],
  };
}

describe("embedding configuration", () => {
  it("resolves file paths at the config and CLI paths at the caller", () => {
    writeFileSync(
      join(directory, "pmcp.toml"),
      '[embedding]\nmodel = "embeddinggemma-2"\nmodel_path = "models"\ncache_dir = "cache"\ndimensions = 256\n',
    );
    const nested = join(directory, "nested");
    mkdirSync(nested);
    expect(embeddingFrom(context([], nested))).toMatchObject({
      modelId: "embeddinggemma-2",
      dimensions: 256,
      modelPath: join(directory, "models"),
      cacheDir: join(directory, "cache"),
    });
    expect(
      embeddingFrom(
        context(["--model-path", "local", "--dimensions", "128"], nested),
      ),
    ).toMatchObject({ dimensions: 128, modelPath: join(nested, "local") });
    expect(
      embeddingFrom(context(["--no-config", "--model", "e5-small"])),
    ).toMatchObject({
      modelId: "e5-small",
      dimensions: undefined,
      modelPath: undefined,
    });
  });

  it("supports a custom encoder and CLI prefix overrides", () => {
    writeFileSync(
      join(directory, "pmcp.toml"),
      '[embedding]\nmodel = "vendor/model"\n[embedding.encoder]\nquery_prefix = "intent: "\npassage_prefix = "doc: "\npooling = "cls"\n',
    );
    expect(
      embeddingFrom(context(["--query-prefix", "search: "])).encoder,
    ).toEqual({
      queryPrefix: "search: ",
      passagePrefix: "doc: ",
      pooling: "cls",
    });
  });

  it.each([
    '[embedding]\nmodel = "embeddinggemma-2"\ndimension = 256',
    '[embedding]\nmodel = "embeddinggemma-2"\ndimensions = "256"',
    '[embedding]\nenabled = "false"',
    '[embedding]\nmodel = "e5-small"\ndtype = "q4"',
    "[embedding.encoder]\nquery_prefix = 42",
    '[embedding.encoder]\npolling = "cls"',
  ])("rejects malformed embedding configuration: %s", (text) => {
    writeFileSync(join(directory, "pmcp.toml"), text);
    expect(() => readConfig(join(directory, "pmcp.toml"))).toThrow(ConfigError);
  });

  it("reports invalid CLI dimensions as a usage error", () => {
    expect(() => embeddingFrom(context(["--dimensions", "NaN"]))).toThrow(
      ArgumentError,
    );
  });

  it("lists presets without model loading", async () => {
    const cli = context(["--json"]);
    expect(await modelsCommand.run(cli)).toBe(0);
    const data = JSON.parse(vi.mocked(cli.ui.data).mock.calls[0]![0]);
    expect(data.map((model: { name: string }) => model.name)).toEqual([
      "e5-small",
      "embeddinggemma-300m",
      "embeddinggemma-2",
    ]);
  });

  it("plans an index without installing a model or creating a database", async () => {
    const skill = join(directory, "skills", "git");
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name: "@acme/tools" }),
    );
    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: git\ndescription: Review changes and commit\n---\nReview a patch.\n",
    );
    const cli = context([
      "--root",
      directory,
      "--package",
      directory,
      "--model",
      "embeddinggemma-2",
      "--dry-run",
    ]);
    expect(await indexCommand.run(cli)).toBe(0);
    expect(cli.ui.line).toHaveBeenCalledWith("  would encode @acme/tools/git");
    expect(existsSync(join(directory, ".cache"))).toBe(false);
  });
});
