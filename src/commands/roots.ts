// Share catalog options so flags keep the same meaning across commands.

import { many, type CommandContext } from "../cli/command.js";
import {
  readCatalog,
  type CatalogOptions,
  type SkillEntry,
} from "../catalog.js";
import { publicMarketplaceRoot } from "../marketplace/builtin.js";
import { configFrom } from "./config-from.js";

export { CATALOG_OPTIONS } from "./options/catalog.js";
export { configFrom };

export function rootsFrom(context: CommandContext): readonly string[] {
  const given = many(context.args, "root");
  if (given.length > 0) return given;
  const config = configFrom(context);
  if (config?.catalog.roots !== undefined) return config.catalog.roots;
  return [`${config?.dir ?? context.cwd}/node_modules`];
}

export function catalogOptionsFrom(
  context: CommandContext,
  onReject?: CatalogOptions["onReject"],
): CatalogOptions {
  const config = configFrom(context)?.catalog ?? {};

  const pick = (flag: string, fromFile: readonly string[] | undefined) => {
    const given = many(context.args, flag);
    return given.length > 0 ? given : (fromFile ?? []);
  };
  const scopes = pick("scope", config.scopes);
  const marketplaces = pick("marketplace", config.marketplaces);
  const selectedMarketplaces = [...marketplaces];
  if (!context.args.flags.has("no-builtin") && config.builtin !== false)
    selectedMarketplaces.push(publicMarketplaceRoot());
  const packages = pick("package", config.packages);
  const workspaces = pick("workspace", config.workspaces);
  return {
    roots: rootsFrom(context),
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(selectedMarketplaces.length > 0
      ? { marketplaces: [...new Set(selectedMarketplaces)] }
      : {}),
    ...(packages.length > 0 ? { packages } : {}),
    ...(workspaces.length > 0 ? { workspaces } : {}),
    ...(onReject ? { onReject } : {}),
  };
}

export function catalogFrom(
  context: CommandContext,
  onReject?: CatalogOptions["onReject"],
): SkillEntry[] {
  return readCatalog(catalogOptionsFrom(context, onReject));
}
