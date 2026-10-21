import type { CatalogSkill } from "../../src/metadata/profiles/catalog-v1.js";

export const base = {
  name: "example",
  description:
    "Use when testing metadata validation with realistic skill fixtures.",
  metadata: { level: "L1", domain: "engineering", install: "optional" },
};
export const skill = (overrides: Partial<CatalogSkill> = {}): CatalogSkill => ({
  tier: "open",
  dirName: "example",
  front: base,
  body: "",
  hasScripts: false,
  localeFiles: [],
  ...overrides,
});
export const withMeta = (metadata: object) => ({
  ...base,
  metadata: { ...base.metadata, ...metadata },
});
