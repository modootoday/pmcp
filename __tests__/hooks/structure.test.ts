import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const RUNTIME_STRINGS =
  /"(Bash|apply_patch|Edit|Write|MultiEdit|NotebookEdit|PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|hookSpecificOutput|permissionDecision)"|\b(PreToolUse|PostToolUse|UserPromptSubmit|hookSpecificOutput)\b/u;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("hook layering", () => {
  it("keeps runtime strings under src/hooks/runtimes/<id>/ only", () => {
    const offenders = [
      ...sources(join(ROOT, "src/hooks")),
      ...sources(join(ROOT, "src/logging")),
      ...sources(join(ROOT, "src/sessions")),
    ]
      .map((file) => relative(ROOT, file))
      .filter((file) => !/^src\/hooks\/runtimes\/[a-z]+\//u.test(file))
      .filter((file) =>
        RUNTIME_STRINGS.test(readFileSync(join(ROOT, file), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps each runtime's strings out of the other runtime", () => {
    const claude = sources(join(ROOT, "src/hooks/runtimes/claude")).map(
      (file) => readFileSync(file, "utf8"),
    );
    expect(claude.some((text) => text.includes("apply_patch"))).toBe(false);
  });

  it("never lets policies import runtime adapters", () => {
    const offenders = sources(join(ROOT, "src/hooks/policies")).filter((file) =>
      /from "\.\.\/(\.\.\/)?runtimes\//u.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("bundles the hook without zod, smol-toml, yaml or the MCP server", async () => {
    const result = await build({
      entryPoints: [join(ROOT, "src/hooks/entry.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(
      inputs.filter((path) =>
        /node_modules|zod|smol-toml|yaml|modelcontextprotocol/u.test(path),
      ),
    ).toEqual([]);
    expect(
      inputs.filter(
        (path) => !/^src\/(hooks|logging|sessions|git)\//u.test(path),
      ),
    ).toEqual([]);
    expect(
      inputs.filter((path) =>
        /^src\/(sessions\/(cli|status)|logging\/(cli|query)|hooks\/compile[./]|git\/(cli|config|setup|mainline))/u.test(
          path,
        ),
      ),
    ).toEqual([]);
  });

  it("keeps logging and the contract free of imports from the rest of pmcp", () => {
    const offenders = [
      ...sources(join(ROOT, "src/logging")).filter(
        (file) => !file.endsWith("/cli.ts"),
      ),
      join(ROOT, "src/hooks/contract.ts"),
    ].filter((file) =>
      /from "\.\.\/(\.\.\/)?(hooks|sessions|project|cli)\//u.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
