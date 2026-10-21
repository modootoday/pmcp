import { describe, expect, it } from "vitest";
import {
  catalogV1,
  parseFrontmatter,
  skillFindings,
  referenceFindings,
  installDefaultFindings,
  unregisteredFindings,
  trackedResultsFindings,
  pluginNamingFindings,
  duplicatePluginFindings,
  descriptionDriftFindings,
  gatedNameFindings,
} from "../../src/metadata/profiles/catalog-v1.js";
import type { CatalogSkill } from "../../src/metadata/profiles/catalog-v1.js";
import { base, skill, withMeta } from "./_shared.js";

describe("catalog-v1", () => {
  it("requires strict catalog keys but accepts inherited tier", () => {
    expect(catalogV1.safeParse(base).success).toBe(true);
    for (const metadata of [
      { extra: true },
      { requires: { extra: [] } },
      { version: "01.0.0" },
      { locales: ["eng"] },
      { keywords: "word" },
      { level: "L6" },
    ])
      expect(catalogV1.safeParse(withMeta(metadata)).success).toBe(false);
    expect(skillFindings(skill())).toEqual([]);
  });
  it.each([
    ["name.directory", { dirName: "other" }],
    ["tier.mismatch", { front: withMeta({ tier: "paid" }) }],
    [
      "description.ascii",
      { front: { ...base, description: base.description + "\uD55C" } },
    ],
    [
      "description.trigger",
      {
        front: {
          ...base,
          description:
            "This description is long enough but has no use trigger.",
        },
      },
    ],
    ["keywords.ascii", { front: withMeta({ keywords: ["\uD55C\uAE00"] }) }],
    ["output-license.required", { front: withMeta({ domain: "asset-image" }) }],
    ["approval.required", { hasScripts: true }],
    ["pair.tier", { front: withMeta({ pair: [] }) }],
    ["server-tools.forbidden", { front: withMeta({ "server-tools": [] }) }],
    ["server-tools.required", { tier: "paid" }],
    [
      "server-tools.order",
      { tier: "paid", body: "job_submit then job_estimate" },
    ],
    [
      "install.default",
      { tier: "free", front: withMeta({ install: "default" }) },
    ],
    ["locales.files", { localeFiles: ["ko"] }],
  ] as [string, Partial<CatalogSkill>][])("enforces %s", (rule, overrides) => {
    expect(skillFindings(skill(overrides)).some((f) => f.rule === rule)).toBe(
      true,
    );
  });
  it("applies tier exceptions and paid requirements", () => {
    expect(
      skillFindings(
        skill({
          tier: "internal",
          front: { ...base, description: "\uD55C\uAE00".repeat(45) },
        }),
      ),
    ).toEqual([]);
    expect(
      skillFindings(
        skill({
          tier: "paid",
          front: withMeta({
            "output-license": "MIT",
            approval: "none",
            "server-tools": ["job_estimate", "job_submit"],
          }),
          body: "job_estimate then job_submit",
        }),
      ),
    ).toEqual([]);
  });
  it("checks references, cross-tier names and default caps", () => {
    const catalog = new Map([
      ["lower", "open"],
      ["higher", "paid"],
    ] as const);
    expect(
      referenceFindings(
        skill({
          front: withMeta({ pair: ["higher", "missing"] }),
          body: "higher",
        }),
        catalog,
      ),
    ).toHaveLength(3);
    expect(
      referenceFindings(
        skill({ tier: "free", front: withMeta({ pair: ["lower"] }) }),
        catalog,
      ),
    ).toEqual([]);
    expect(
      gatedNameFindings("higher higher-ish", catalog, new Set()),
    ).toHaveLength(1);
    expect(gatedNameFindings("higher-ish", catalog, new Set())).toEqual([]);
    expect(
      installDefaultFindings(
        Array.from({ length: 6 }, () => ({ install: "default" })),
        "open",
      ),
    ).toHaveLength(1);
  });
  it("ports plugin registration, naming, duplicate, drift and tracked result rules", () => {
    expect(unregisteredFindings(["a", "b"], ["a"])).toHaveLength(1);
    expect(
      trackedResultsFindings([
        "plugins/a/evals/results/run.json",
        "plugins/a/evals/case.json",
      ]),
    ).toHaveLength(1);
    expect(pluginNamingFindings("free", ["a", "a-plus"])).toHaveLength(1);
    expect(pluginNamingFindings("open", ["a", "a-plus"])).toHaveLength(1);
    expect(
      duplicatePluginFindings(["a"], new Map([["paid", ["a"]]])),
    ).toHaveLength(1);
    expect(
      descriptionDriftFindings({ name: "a", entry: "x", plugin: "y" }),
    ).toHaveLength(1);
  });
  it("parses full YAML and reports missing frontmatter", () => {
    expect(
      parseFrontmatter("---\nmetadata:\n  keywords: [404, 500]\n---\n").front,
    ).toEqual({ metadata: { keywords: ["404", "500"] } });
    expect(
      parseFrontmatter(
        "---\nname: example\nmetadata:\n  keywords:\n    - test\n---\nbody",
      ),
    ).toEqual({
      front: { name: "example", metadata: { keywords: ["test"] } },
      body: "body",
    });
    expect(
      skillFindings(skill({ front: parseFrontmatter("body").front }))[0]?.rule,
    ).toBe("schema.frontmatter");
  });
});
