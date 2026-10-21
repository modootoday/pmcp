import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  skillFrontmatter,
  skillMetadataCore,
  marketplaceManifest,
  pluginManifest,
  TIERS,
  RUNTIMES,
  inheritSkillMetadata,
  projectPluginIdentity,
} from "../../src/metadata/schema.js";
import { skillFindings } from "../../src/metadata/profiles/catalog-v1.js";
import { skill, withMeta } from "./_shared.js";

describe("metadata contracts", () => {
  it("keeps native fields and unknown metadata open", () => {
    expect(
      skillFrontmatter.parse({
        name: "x",
        description: "x",
        custom: 1,
        metadata: { custom: true },
      }),
    ).toMatchObject({ custom: 1, metadata: { custom: true } });
    expect(skillFrontmatter.safeParse({ name: "x" }).success).toBe(false);
    expect(
      pluginManifest.parse({ name: "x", mcpServers: { server: {} } }),
    ).toHaveProperty("mcpServers");
  });
  it("has one runtime and tier vocabulary and no medium", () => {
    for (const tier of TIERS)
      expect(skillMetadataCore.safeParse({ tier }).success).toBe(true);
    expect(skillMetadataCore.safeParse({ tier: "medium" }).success).toBe(false);
    expect(
      skillMetadataCore.safeParse({ "verified-runtimes": [...RUNTIMES] })
        .success,
    ).toBe(true);
    expect(
      skillMetadataCore.safeParse({
        "verified-runtimes": ["codex-cli", "codex-cli"],
      }).success,
    ).toBe(false);
  });
  it("validates native manifest fields including rename tombstones", () => {
    expect(
      marketplaceManifest.parse({
        name: "x",
        plugins: [],
        metadata: { tier: "paid" },
        renames: { old: null, previous: "new" },
        owner: { name: "x" },
      }),
    ).toHaveProperty("owner");
    for (const bad of [
      { tier: "open" },
      { version: "1.2" },
      { description: 2 },
      { displayName: "" },
      { renames: { old: 3 } },
      { interface: { displayName: 2 } },
    ])
      expect(pluginManifest.safeParse({ name: "x", ...bad }).success).toBe(
        false,
      );
    expect(
      marketplaceManifest.safeParse({
        name: "x",
        plugins: [],
        metadata: { tier: "medium" },
      }).success,
    ).toBe(false);
  });
  it("inherits versions while preserving explicit differences and projects canonical identity", () => {
    expect(inheritSkillMetadata({}, "free", "1.2.3")).toEqual({
      tier: "free",
      version: "1.2.3",
    });
    expect(
      inheritSkillMetadata({ version: "2.0.0" }, "open", "1.2.3").version,
    ).toBe("2.0.0");
    expect(
      projectPluginIdentity(
        { description: "stale", version: "0.0.0", mcpServers: {} },
        { name: "x", description: "canonical", version: "1.0.0" },
      ),
    ).toEqual({ description: "canonical", version: "1.0.0", mcpServers: {} });
    expect(
      skillFindings(
        skill({
          front: withMeta({ tier: "open", version: "1.0.0" }),
          pluginVersion: "1.0.0",
        }),
      ),
    ).toHaveLength(2);
  });
  it("keeps unknown metadata namespaces open in the core", () => {
    expect(
      skillMetadataCore.parse({ "skills.modoo.today": { future: true } }),
    ).toBeDefined();
  });
  it("exports reproducible JSON schemas with generated field annotations", () => {
    const generated = JSON.parse(
      readFileSync(
        new URL("../../schema/skill-metadata-core.json", import.meta.url),
        "utf8",
      ),
    );
    expect(generated).toEqual(z.toJSONSchema(skillMetadataCore));
    expect(generated.properties["verified-runtimes"].readOnly).toBe(true);
    expect(generated.properties.tier.deprecated).toBe(true);
  });
});
