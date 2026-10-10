/**
 * The options every command that reads the catalog shares, declared once so a
 * flag cannot mean one thing under list and another under index.
 */

import {
  ArgumentError,
  many,
  one,
  type CommandContext,
  type OptionSpec,
} from "../cli/command.js";
import {
  readCatalog,
  type CatalogOptions,
  type SkillEntry,
} from "../catalog.js";
import {
  ConfigError,
  findConfig,
  readConfig,
  type ProjectConfig,
} from "../config.js";

export const CATALOG_OPTIONS: readonly OptionSpec[] = [
  {
    name: "root",
    describe: "A node_modules directory to walk. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "scope",
    describe: "Only packages whose names start with this. Repeatable.",
    repeat: true,
    placeholder: "<prefix>",
  },
  {
    name: "marketplace",
    describe:
      "A plugin marketplace directory (holds .claude-plugin/marketplace.json). Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "package",
    describe:
      "A package directory read directly, for one no node_modules links; without a package.json its folder name is the package name. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "workspace",
    describe:
      "A workspace root, or a glob of them: each root and every member its workspaces globs name. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "config",
    describe:
      "A pmcp.toml to read instead of the nearest one at or above the working directory.",
    placeholder: "<file>",
  },
  {
    name: "no-config",
    describe: "Ignore pmcp.toml; only the flags given count.",
    boolean: true,
  },
];

/**
 * The pmcp.toml in force, or null. A file named by --config must exist; one
 * found by walking up is optional.
 */
export function configFrom(context: CommandContext): ProjectConfig | null {
  if (context.args.flags.has("no-config")) return null;
  const named = one(context.args, "config");
  const path = named ?? findConfig(context.cwd);
  if (path === null) return null;
  try {
    return readConfig(path);
  } catch (error) {
    if (error instanceof ConfigError) throw new ArgumentError(error.message);
    if (named !== undefined) throw new ArgumentError(`cannot read ${named}`);
    throw error;
  }
}

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
  // A flag replaces the file's list of the same kind rather than adding to it.
  const pick = (flag: string, fromFile: readonly string[] | undefined) => {
    const given = many(context.args, flag);
    return given.length > 0 ? given : (fromFile ?? []);
  };
  const scopes = pick("scope", config.scopes);
  const marketplaces = pick("marketplace", config.marketplaces);
  const packages = pick("package", config.packages);
  const workspaces = pick("workspace", config.workspaces);
  return {
    roots: rootsFrom(context),
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(marketplaces.length > 0 ? { marketplaces } : {}),
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
