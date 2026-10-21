// Use absolute marketplace paths because Codex resolves relative sources against the session directory.

import type {
  DeclaredMarketplace,
  KeyedValue,
  MarketplaceRuntime,
  MarketplaceSource,
} from "./types.js";

export type BuiltinRoot = () => string;

export function pluginId(plugin: string, marketplace: string): string {
  return `${plugin}@${marketplace}`;
}

export function forRuntime(
  declared: readonly DeclaredMarketplace[],
  runtime: MarketplaceRuntime,
): { marketplace: DeclaredMarketplace; plugins: string[] }[] {
  return declared
    .map((marketplace) => ({
      marketplace,
      plugins: marketplace.plugins
        .filter((plugin) => plugin.targets.includes(runtime))
        .map((plugin) => plugin.name),
    }))
    .filter((entry) => entry.plugins.length > 0);
}

function localPath(
  source: MarketplaceSource,
  builtinRoot: BuiltinRoot,
): string {
  return source.kind === "path" ? source.path : builtinRoot();
}

function claudeSource(
  source: MarketplaceSource,
  builtinRoot: BuiltinRoot,
): object {
  if (source.kind !== "github")
    return { source: "directory", path: localPath(source, builtinRoot) };
  return source.ref === undefined
    ? { source: "github", repo: source.repo }
    : { source: "github", repo: source.repo, ref: source.ref };
}

export function claudeSettings(
  declared: readonly DeclaredMarketplace[],
  builtinRoot: BuiltinRoot,
): KeyedValue[] {
  const entries: KeyedValue[] = [];
  for (const { marketplace, plugins } of forRuntime(declared, "claude")) {
    entries.push({
      key: ["extraKnownMarketplaces", marketplace.name],
      value: { source: claudeSource(marketplace.source, builtinRoot) },
    });
    for (const plugin of plugins)
      entries.push({
        key: ["enabledPlugins", pluginId(plugin, marketplace.name)],
        value: true,
      });
  }
  return entries;
}

const tomlString = (value: string) => JSON.stringify(value);

export function codexAddArguments(
  source: MarketplaceSource,
  builtinRoot: BuiltinRoot,
): string[] {
  if (source.kind !== "github") return [localPath(source, builtinRoot)];
  return source.ref === undefined
    ? [source.repo]
    : [source.repo, "--ref", source.ref];
}

export function codexConfig(
  declared: readonly DeclaredMarketplace[],
  builtinRoot: BuiltinRoot,
): string {
  const lines: string[] = [];
  for (const { marketplace, plugins } of forRuntime(declared, "codex")) {
    const source = marketplace.source;
    lines.push(`[marketplaces.${marketplace.name}]`);
    if (source.kind === "github") {
      lines.push(`source_type = "git"`);
      lines.push(
        `source = ${tomlString(`https://github.com/${source.repo}.git`)}`,
      );
      if (source.ref !== undefined)
        lines.push(`ref = ${tomlString(source.ref)}`);
    }
    if (source.kind !== "github") {
      lines.push(`source_type = "local"`);
      lines.push(`source = ${tomlString(localPath(source, builtinRoot))}`);
    }
    lines.push("");
    for (const plugin of plugins) {
      lines.push(`[plugins.${tomlString(pluginId(plugin, marketplace.name))}]`);
      lines.push("enabled = true");
      lines.push("");
    }
  }
  return lines.join("\n");
}
