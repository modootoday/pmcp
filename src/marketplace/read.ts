import { readLocalMarketplace } from "../marketplace/local.js";
import { type SkillEntry } from "../catalog.js";
import type { Rejection } from "./types.js";
import type { PluginManifest } from "./types.js";
import type { Context } from "./types.js";
import { skillEntries } from "./skills.js";
import { commandEntries } from "./commands.js";
import { agentEntries } from "./agents.js";
import { hookEntries } from "./hooks.js";
import { mcpEntries } from "./mcp.js";
export function readMarketplace(
  dir: string,
  onReject?: (rejection: Rejection) => void,
): SkillEntry[] {
  const marketplace = readLocalMarketplace(dir, onReject);
  if (!marketplace) return [];
  const found: SkillEntry[] = [];
  for (const plugin of marketplace.plugins) {
    const pluginManifest = plugin.manifest as PluginManifest;
    const context: Context = {
      marketplace: marketplace.name,
      plugin: plugin.name,
      pluginDir: plugin.directory,
      pluginDescription:
        typeof pluginManifest.description === "string"
          ? pluginManifest.description
          : undefined,
      tier: marketplace.tier,
      onReject,
    };
    found.push(
      ...skillEntries(context),
      ...commandEntries(context),
      ...agentEntries(context),
      ...hookEntries(context, pluginManifest),
      ...mcpEntries(context),
    );
  }
  return found;
}
