import type { ProjectConfig } from "../config.js";
import { policyRows } from "../hooks/inspection/list.js";
import type { ProjectSpec } from "../project/spec.js";
import type { Feature } from "./types.js";

export function features(config: ProjectConfig, spec: ProjectSpec): Feature[] {
  const rows = new Map<string, Feature>();
  for (const row of policyRows(spec.hookBundle?.policy)) {
    const source = spec.featureSources?.[row.policy] ?? "toml";
    rows.set(row.policy, {
      feature: row.policy,
      enabled: row.mode !== "off",
      source: source === "auto" ? "auto" : row.source,
    });
  }
  for (const [name, value] of Object.entries(config.raw)) {
    if (name === "hooks" || name === "sessions") continue;
    const table = value as Record<string, unknown>;
    if (!table || typeof table !== "object") continue;
    rows.set(name, {
      feature: name,
      enabled: table.enabled !== false,
      source: table.enabled === "auto" ? "auto" : name,
    });
  }
  if (!rows.has("logging"))
    rows.set("logging", {
      feature: "logging",
      enabled: spec.hookBundle?.policy?.log.enabled ?? true,
      source: "default",
    });
  return [...rows.values()];
}
