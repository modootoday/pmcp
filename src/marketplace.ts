import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { containedPath, readLocalMarketplace } from "./marketplace/local.js";

import { readFrontmatter, type SkillEntry } from "./catalog.js";
import {
  frontmatterObject,
  frontmatterText,
  metadataOf,
  type MetadataValue,
} from "./frontmatter.js";

export type { MetadataValue };

/** Why an asset was left out rather than served. */
export interface Rejection {
  readonly path: string;
  readonly reason: string;
}

interface PluginManifest {
  readonly description?: string;
  readonly hooks?: unknown;
}

/** The `metadata:` map of a frontmatter: strings, string lists and maps of those. */
export function readMetadata(source: string): Record<string, MetadataValue> {
  return metadataOf(frontmatterObject(source));
}

/** The raw frontmatter text between the fences, for skill_describe. */
export function readFrontmatterText(source: string): string {
  return frontmatterText(source) ?? "";
}

const asString = (value: MetadataValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const asList = (value: MetadataValue | undefined): readonly string[] => {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
};

function readJson(path: string, root: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(containedPath(root, path), "utf8"),
    );
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface Context {
  readonly marketplace: string;
  readonly plugin: string;
  readonly pluginDir: string;
  readonly pluginDescription: string | undefined;
  readonly tier: string | undefined;
  readonly onReject: ((rejection: Rejection) => void) | undefined;
}

/**
 * A Markdown asset with frontmatter: a skill, a command or an agent. A tier
 * that disagrees with the marketplace's is rejected, because a mislabelled
 * tier is how a private asset leaks.
 */
function markdownEntry(
  context: Context,
  path: string,
  fallbackSlug: string,
  shape: { kind?: "agent"; root?: string; namespace?: string },
): SkillEntry | null {
  let source: string;
  try {
    source = readFileSync(containedPath(context.pluginDir, path), "utf8");
  } catch {
    context.onReject?.({
      path,
      reason: "Asset is unreadable or outside the plugin root",
    });
    return null;
  }
  const front = readFrontmatter(source);
  const description = front["description"] ?? "";
  if (description === "") {
    context.onReject?.({ path, reason: "no description" });
    return null;
  }
  const metadata = readMetadata(source);
  const ownTier = asString(metadata["tier"]);
  if (
    context.tier !== undefined &&
    ownTier !== undefined &&
    ownTier !== context.tier
  ) {
    context.onReject?.({
      path,
      reason: `metadata.tier ${ownTier} in a ${context.tier} marketplace`,
    });
    return null;
  }
  const slug = front["name"] ?? fallbackSlug;
  const prefix = `${context.marketplace}/${context.plugin}`;
  return {
    name: shape.namespace
      ? `${prefix}/${shape.namespace}/${slug}`
      : `${prefix}/${slug}`,
    package: prefix,
    slug,
    description,
    path,
    tier: ownTier ?? context.tier,
    metadata,
    keywords: asList(metadata["keywords"]),
    ...(shape.kind ? { kind: shape.kind } : {}),
    ...(shape.root ? { root: shape.root } : {}),
  };
}

function skillEntries(context: Context): SkillEntry[] {
  const dir = join(context.pluginDir, "skills");
  if (!existsSync(dir)) return [];
  const found: SkillEntry[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const path = join(dir, child.name, "SKILL.md");
    if (!existsSync(path)) continue;
    const entry = markdownEntry(context, path, child.name, {});
    if (entry) found.push(entry);
  }
  return found;
}

/** A command is a one-file skill: the file is everything describe and read may open. */
function commandEntries(context: Context): SkillEntry[] {
  const dir = join(context.pluginDir, "commands");
  if (!existsSync(dir)) return [];
  const found: SkillEntry[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isFile() || !child.name.endsWith(".md")) continue;
    const path = join(dir, child.name);
    const entry = markdownEntry(context, path, basename(child.name, ".md"), {
      root: path,
    });
    if (entry) found.push(entry);
  }
  return found;
}

/** Flat `agents/<name>.md`, and the directory form `agents/<name>/agent.md`. */
function agentEntries(context: Context): SkillEntry[] {
  const dir = join(context.pluginDir, "agents");
  if (!existsSync(dir)) return [];
  const found: SkillEntry[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    let entry: SkillEntry | null = null;
    if (child.isFile() && child.name.endsWith(".md")) {
      const path = join(dir, child.name);
      entry = markdownEntry(context, path, basename(child.name, ".md"), {
        kind: "agent",
        root: path,
        namespace: "agents",
      });
    } else if (
      child.isDirectory() &&
      existsSync(join(dir, child.name, "agent.md"))
    ) {
      entry = markdownEntry(
        context,
        join(dir, child.name, "agent.md"),
        child.name,
        {
          kind: "agent",
          namespace: "agents",
        },
      );
    }
    if (entry) found.push(entry);
  }
  return found;
}

/**
 * One entry for a plugin's hooks. Its scope is the whole plugin, because a
 * hook command runs the plugin's own scripts.
 */
function hookEntries(context: Context, manifest: PluginManifest): SkillEntry[] {
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

/** One entry per server in a plugin's `.mcp.json`; the file is its scope. */
function mcpEntries(context: Context): SkillEntry[] {
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

/** Every asset one marketplace lists. */
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

/** The directory or single file an entry's describe and read may open. */
export const assetRoot = (entry: Pick<SkillEntry, "root" | "path">): string =>
  entry.root ?? dirname(entry.path);
