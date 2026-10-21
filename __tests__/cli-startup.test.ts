import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const recorder = fileURLToPath(
  new URL("./fixtures/record-modules.mjs", import.meta.url),
);
const STATIC_IMPORT =
  /\b(?:import|export)\s*(?:[^"';()]*?\bfrom\s*)?["']([^"']+)["']/gu;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;
const MODULE_COMMENT = /^\/\/ (src\/\S+)$/gmu;
const HEAVY: Readonly<Record<string, RegExp>> = {
  zod: /^import:zod(?:\/|$)/u,
  mcp: /^import:@modelcontextprotocol\//u,
  sqlite:
    /^(?:import:(?:node|bun):sqlite|module:src\/(?:cache|storage\/sqlite|mailbox\/sqlite)\.ts)$/u,
  embedding:
    /^(?:import:@huggingface\/transformers|module:src\/(?:embed|encoder)\.ts)$/u,
};

interface Graph {
  readonly files: Set<string>;
  readonly labels: string[];
}

// Dependencies stay external, so a bare import names them; esbuild heads each
// bundled source module with a path comment because the build is not minified.
function graph(entry: string, dynamic: boolean): Graph {
  const files = new Set<string>();
  const labels: string[] = [];
  const patterns = dynamic ? [STATIC_IMPORT, DYNAMIC_IMPORT] : [STATIC_IMPORT];
  const walk = (path: string): void => {
    if (files.has(path)) return;
    files.add(path);
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(MODULE_COMMENT))
      labels.push(`module:${match[1]!}`);
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) walk(resolve(dirname(path), specifier));
        if (!specifier.startsWith(".")) labels.push(`import:${specifier}`);
      }
    }
  };
  walk(join(dist, entry));
  return { files, labels };
}

function heavyIn(labels: readonly string[]): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [name, pattern] of Object.entries(HEAVY)) {
    found[name] = [...new Set(labels.filter((label) => pattern.test(label)))];
  }
  return found;
}

const scratch = mkdtempSync(join(tmpdir(), "pmcp-startup-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function loadedFiles(args: readonly string[]): string[] {
  const record = join(scratch, `${args.join("_")}.json`);
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(recorder).href, join(dist, "cli.js"), ...args],
    {
      encoding: "utf8",
      cwd: scratch,
      env: { ...process.env, PMCP_MODULE_RECORD: record },
    },
  );
  expect(result.status).toBe(0);
  const urls: string[] = JSON.parse(readFileSync(record, "utf8"));
  return urls
    .filter((url) => url.startsWith("file:"))
    .map((url) => fileURLToPath(url))
    .filter((path) => path !== recorder);
}

describe("the CLI entry", () => {
  const entry = graph("cli.js", false);
  const full = graph("cli.js", true);

  it("statically imports no zod, MCP SDK, sqlite or embedding module", () => {
    expect(heavyIn(entry.labels)).toEqual({
      zod: [],
      mcp: [],
      sqlite: [],
      embedding: [],
    });
  });

  it("still reaches each of them through a command chunk", () => {
    for (const labels of Object.values(heavyIn(full.labels)))
      expect(labels.length).toBeGreaterThan(0);
  });

  it("statically imports no command module", () => {
    const commands = entry.labels.filter((label) =>
      /^module:src\/commands\/(?!index|dispatch|registry|version|specs\/|options\/|harness\/options|tui\/options)/u.test(
        label,
      ),
    );
    expect(commands).toEqual([]);
    expect(entry.labels).toContain("module:src/commands/registry.ts");
  });

  it.each([
    ["--version"],
    ["--help"],
    ["project", "--help"],
    ["status", "--help"],
    ["init", "--help"],
    ["hooks", "--help"],
  ])("loads only the entry graph and no dependency for %s", (...args) => {
    const loaded = loadedFiles(args);
    expect(loaded).toContain(join(dist, "cli.js"));
    expect(loaded.filter((path) => !entry.files.has(path))).toEqual([]);
  });

  it("loads one more chunk once a command runs", () => {
    const loaded = loadedFiles(["completion", "bash"]);
    expect(loaded.filter((path) => !entry.files.has(path)).length).toBe(1);
  });

  it("keeps copied artifacts self-contained", () => {
    for (const artifact of [
      "project/hook-adapter.js",
      "harness-egress-bridge.js",
    ]) {
      const built = graph(artifact, true);
      expect([...built.files]).toEqual([join(dist, artifact)]);
    }
  });
});
