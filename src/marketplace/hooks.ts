import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type SkillEntry } from "../catalog.js";
import type { PluginManifest } from "./types.js";
import type { Context } from "./types.js";
import { readJson } from "./_shared.js";
export function hookEntries(
  context: Context,
  manifest: PluginManifest,
): SkillEntry[] {
  const declared =
    typeof manifest.hooks === "string" ? manifest.hooks : undefined;
  const path = resolve(context.pluginDir, declared ?? "hooks/hooks.json");
  if (!existsSync(path)) return [];
  const hooks = readJson(path, context.pluginDir);
  if (hooks === null) {
    context.onReject?.({ path, reason: "hooks.json is not a JSON object" });
    return [];
  }
  const own =
    typeof hooks["description"] === "string" ? hooks["description"] : undefined;
  const description = own ?? context.pluginDescription ?? "";
  if (description === "") {
    context.onReject?.({ path, reason: "no description" });
    return [];
  }
  const prefix = `${context.marketplace}/${context.plugin}`;
  return [
    {
      name: `${prefix}/hooks`,
      package: prefix,
      slug: "hooks",
      description,
      path,
      tier: context.tier,
      kind: "hook",
      root: context.pluginDir,
    },
  ];
}
