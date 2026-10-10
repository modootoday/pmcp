import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface MarketplaceRejection {
  readonly path: string;
  readonly reason: string;
}

export interface LocalPlugin {
  readonly name: string;
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface LocalMarketplace {
  readonly name: string;
  readonly tier?: string;
  readonly plugins: readonly LocalPlugin[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function containedPath(root: string, path: string): string {
  const result = resolve(root, path);
  const lexical = relative(resolve(root), result);
  if (isAbsolute(lexical) || lexical === ".." || lexical.startsWith(`..${sep}`))
    throw new Error("Path leaves the plugin root");
  const physical = relative(realpathSync(root), realpathSync(result));
  if (
    isAbsolute(physical) ||
    physical === ".." ||
    physical.startsWith(`..${sep}`)
  )
    throw new Error("Path leaves the plugin root through a symlink");
  return result;
}

export function pluginManifest(
  directory: string,
): Readonly<Record<string, unknown>> {
  for (const path of [
    ".claude-plugin/plugin.json",
    "plugin.json",
    ".codex-plugin/plugin.json",
    ".grok-plugin/plugin.json",
  ]) {
    if (!existsSync(join(directory, path))) continue;
    const value: unknown = JSON.parse(
      readFileSync(containedPath(directory, path), "utf8"),
    );
    if (!object(value)) throw new Error("Plugin manifest must be an object");
    return value;
  }
  return {};
}

function localSource(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    object(value) &&
    value.source === "local" &&
    typeof value.path === "string"
  )
    return value.path;
  throw new Error(
    "Only installed local plugin sources can be read; use the native installer for remote sources",
  );
}

export function readLocalMarketplace(
  directory: string,
  onReject?: (rejection: MarketplaceRejection) => void,
): LocalMarketplace | null {
  const filename = [
    ".claude-plugin/marketplace.json",
    ".agents/plugins/marketplace.json",
    ".grok-plugin/marketplace.json",
  ].find((path) => existsSync(join(directory, path)));
  if (!filename) {
    onReject?.({
      path: directory,
      reason: "No supported native marketplace.json found",
    });
    return null;
  }
  const path = join(directory, filename);
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      readFileSync(containedPath(directory, filename), "utf8"),
    );
  } catch {
    onReject?.({
      path,
      reason: "marketplace.json is not valid JSON or is outside its root",
    });
    return null;
  }
  if (!object(manifest) || !Array.isArray(manifest.plugins)) {
    onReject?.({ path, reason: "marketplace.json requires a plugins array" });
    return null;
  }
  const name =
    typeof manifest.name === "string" ? manifest.name : "marketplace";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(name)) {
    onReject?.({ path, reason: "Invalid marketplace name" });
    return null;
  }
  const plugins: LocalPlugin[] = [];
  const seen = new Set<string>();
  for (const item of manifest.plugins) {
    try {
      if (
        !object(item) ||
        typeof item.name !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(item.name)
      )
        throw new Error("Invalid plugin name");
      if (seen.has(item.name)) throw new Error("Duplicate plugin name");
      const source = localSource(item.source);
      if (!source.startsWith("./") || source.split(/[\\/]/u).includes(".."))
        throw new Error("Local plugin source must be a contained ./ path");
      const pluginDirectory = containedPath(directory, source);
      if (!statSync(pluginDirectory).isDirectory())
        throw new Error("Plugin source must be a directory");
      const metadata = pluginManifest(pluginDirectory);
      if (metadata.name !== undefined && metadata.name !== item.name)
        throw new Error("Plugin manifest name differs from marketplace entry");
      seen.add(item.name);
      plugins.push({
        name: item.name,
        directory: pluginDirectory,
        manifest: metadata,
      });
    } catch (error) {
      onReject?.({
        path,
        reason:
          error instanceof Error ? error.message : "Invalid plugin source",
      });
    }
  }
  const metadata = object(manifest.metadata) ? manifest.metadata : {};
  return {
    name,
    plugins,
    ...(typeof metadata.tier === "string" ? { tier: metadata.tier } : {}),
  };
}
