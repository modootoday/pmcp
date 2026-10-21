import { existsSync } from "node:fs";
import { join } from "node:path";
import { type SkillEntry } from "../catalog.js";
import type { Context } from "./types.js";
import { readJson } from "./_shared.js";
export function mcpEntries(context: Context): SkillEntry[] {
  const filename = [".mcp.json", "mcp.json", "mcp_config.json"].find((name) =>
    existsSync(join(context.pluginDir, name)),
  );
  if (!filename) return [];
  const path = join(context.pluginDir, filename);
  const config = readJson(path, context.pluginDir);
  const servers = config?.["mcpServers"];
  if (
    servers === null ||
    typeof servers !== "object" ||
    Array.isArray(servers)
  ) {
    context.onReject?.({ path, reason: ".mcp.json has no mcpServers object" });
    return [];
  }
  const prefix = `${context.marketplace}/${context.plugin}`;
  return Object.keys(servers).map((server) => ({
    name: `${prefix}/mcp/${server}`,
    package: prefix,
    slug: server,
    description: context.pluginDescription
      ? `MCP server ${server}. ${context.pluginDescription}`
      : `MCP server ${server} from plugin ${context.plugin}.`,
    path,
    tier: context.tier,
    kind: "mcp" as const,
    root: path,
  }));
}
