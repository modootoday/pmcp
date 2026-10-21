import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalSkillDirectory,
  pmcpSkillDirectories,
} from "../scripts/library-skills/layout.mjs";
import {
  MOD_HOOKS,
  pluginManifests,
} from "../scripts/marketplace/manifests.mjs";
import { modFiles } from "../scripts/marketplace/mod.mjs";
import { staleGenerated } from "../scripts/marketplace/projections.mjs";

const root = join(import.meta.dirname, "..");
const roots: string[] = [];
afterEach(() => {
  for (const item of roots.splice(0))
    rmSync(item, { recursive: true, force: true });
});
function temporary(): string {
  const item = mkdtempSync(join(tmpdir(), "pmcp-surfaces-"));
  roots.push(item);
  return item;
}
const json = (path: string) =>
  JSON.parse(readFileSync(join(root, path), "utf8"));

const core = {
  id: "pmcp",
  version: "1.0.0",
  description: "core",
  bridge: true,
  mod: true,
};

describe("pmcp plugin manifests", () => {
  it("lists the mod only in the Claude manifest of the plugin directory", () => {
    const files = pluginManifests(core, { withMod: true });
    expect(files.get(".claude-plugin/plugin.json")?.["hooks"]).toEqual([
      MOD_HOOKS,
    ]);
    expect(JSON.stringify(files.get("plugin.json"))).not.toContain(MOD_HOOKS);
    expect(files.get("plugin.json")?.["hooks"]).toBeUndefined();
    expect(JSON.stringify(files.get("gemini-extension.json"))).not.toContain(
      MOD_HOOKS,
    );
    expect(
      pluginManifests(core).get(".claude-plugin/plugin.json")?.["hooks"],
    ).toBeUndefined();
  });

  it("ships the split in the generated plugin and keeps the package root manifest mod-free", () => {
    expect(json("plugins/pmcp/.claude-plugin/plugin.json").hooks).toEqual([
      MOD_HOOKS,
    ]);
    expect(json("plugins/pmcp/plugin.json").hooks).toBeUndefined();
    expect(json(".claude-plugin/plugin.json").hooks).toBeUndefined();
    expect(json("plugins/pmcp/mod/hooks.json").modules).toEqual([
      "./register.tsx",
    ]);
  });
});

describe("canonical pmcp skills", () => {
  it("generates plugins/pmcp/skills from every root skill and ships no evals", () => {
    const canonical = readdirSync(join(root, "skills")).sort();
    expect(canonical).toHaveLength(7);
    expect(canonical).not.toContain("skill-catalog-navigator");
    expect(readdirSync(join(root, "plugins/pmcp/skills")).sort()).toEqual(
      canonical,
    );
    for (const name of canonical)
      expect(
        readFileSync(join(root, "plugins/pmcp/skills", name, "SKILL.md")),
      ).toEqual(readFileSync(join(root, "skills", name, "SKILL.md")));
    expect(existsSync(join(root, "plugins/pmcp/evals"))).toBe(false);
    expect(json("package.json").files).not.toContain("evals");
  });

  it("refuses a missing skills directory instead of reading docs/skills", () => {
    const fixture = temporary();
    mkdirSync(join(fixture, "docs/skills/example/1"), { recursive: true });
    expect(() => pmcpSkillDirectories(fixture)).toThrow("skills/ is missing");
    mkdirSync(join(fixture, "plugins"));
    expect(() => canonicalSkillDirectory(fixture, "example", 1)).toThrow(
      "Canonical skill directory is missing: plugins/example-1",
    );
  });

  it("reports generated files no source produces as stale", () => {
    const fixture = temporary();
    mkdirSync(join(fixture, "plugins/pmcp/skills/gone"), { recursive: true });
    writeFileSync(join(fixture, "plugins/pmcp/skills/gone/SKILL.md"), "old\n");
    mkdirSync(join(fixture, "plugins/pmcp/mod"), { recursive: true });
    writeFileSync(join(fixture, "plugins/pmcp/mod/kept.ts"), "");
    const files = new Map([["plugins/pmcp/mod/kept.ts", Buffer.from("")]]);
    expect(staleGenerated(fixture, files)).toEqual([
      "plugins/pmcp/skills/gone/SKILL.md",
    ]);
  });
});

describe("Claude mod build", () => {
  it("copies the mod sources without the agent instruction files", () => {
    const files = [...modFiles(root).keys()];
    expect(files).toContain("plugins/pmcp/mod/register.tsx");
    expect(files).toContain("plugins/pmcp/mod/reader/read.ts");
    expect(files.some((path) => path.endsWith(".md"))).toBe(false);
  });
});
