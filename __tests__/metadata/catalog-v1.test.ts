import { describe, expect, it } from "vitest";
import {
  catalogV1,
  parseFrontmatter,
  skillFindings,
  referenceFindings,
  unregisteredFindings,
  trackedResultsFindings,
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
    ["approval.required", { hasScripts: true }],
    ["pair.tier", { front: withMeta({ pair: [] }) }],
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
  it("holds no one catalog's editorial or commercial rules", () => {
    const fired = (overrides: Partial<CatalogSkill>) =>
      skillFindings(skill(overrides)).map((f) => f.rule);
    expect(
      fired({
        front: {
          ...base,
          description:
            "This description is long enough and says nothing about triggers.",
        },
      }),
    ).toEqual([]);
    expect(fired({ front: withMeta({ keywords: ["한글"] }) })).toEqual([]);
    expect(fired({ front: withMeta({ domain: "asset-image" }) })).toEqual([]);
    expect(
      fired({ front: withMeta({ "server-tools": ["render", "status"] }) }),
    ).toEqual([]);
    expect(
      fired({
        tier: "paid",
        front: withMeta({ approval: "none" }),
        body: "job_submit then job_estimate",
      }),
    ).toEqual([]);
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
  });
  it("ports plugin registration, naming, duplicate, drift and tracked result rules", () => {
    expect(unregisteredFindings(["a", "b"], ["a"])).toHaveLength(1);
    expect(
      trackedResultsFindings([
        "plugins/a/evals/results/run.json",
        "plugins/a/evals/case.json",
      ]),
    ).toHaveLength(1);
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
