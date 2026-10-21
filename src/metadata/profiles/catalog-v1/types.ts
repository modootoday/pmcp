import type { Tier } from "../../schema.js";

export type CatalogSkill = {
  tier: Tier;
  dirName: string;
  front: unknown;
  body: string;
  hasScripts: boolean;
  localeFiles: string[];
  pluginVersion?: string;
};
export type Finding = {
  rule: string;
  message: string;
  severity: "error" | "warning";
};
