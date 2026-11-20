// Share catalog options so flags keep the same meaning across commands.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "smol-toml";

import {
  ArgumentError,
  EXIT,
  many,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import {
  readCatalog,
  type CatalogOptions,
  type SkillEntry,
} from "../catalog.js";
import { ConfigError, findConfig, type ProjectConfig } from "../config.js";
import { publicMarketplaceRoot } from "../marketplace/builtin.js";
import { resolveMarketplaceEntry } from "../project/spec.js";
import { configFrom as baseConfigFrom } from "./config-from.js";
import { CATALOG_OPTIONS } from "./options/catalog.js";
import { jsonOption } from "./options/common.js";

export { CATALOG_OPTIONS };

export function configFrom(context: CommandContext): ProjectConfig | null {
  try {
    return baseConfigFrom(context);
  } catch (error) {
    if (context.args.flags.has("no-config")) return null;
    const named = one(context.args, "config");
    const path = named ?? findConfig(context.cwd);
    if (path === null) return null;
    try {
      const absolute = resolve(path);
      const dir = dirname(absolute);
      const raw = parse(readFileSync(absolute, "utf8")) as Record<
        string,
        unknown
      >;
      const section = (raw["catalog"] ?? {}) as Record<string, unknown>;
      const rawMarketplaces = section["marketplaces"] ?? raw["marketplaces"];
      let marketplaces: string[] | undefined;
      if (Array.isArray(rawMarketplaces)) {
        marketplaces = rawMarketplaces.map((item) => {
          if (typeof item === "string") return resolve(dir, item);
          if (Array.isArray(item))
            return item.map((sub) => resolve(dir, String(sub))).join(", ");
          return String(item);
        });
      }
      return {
        path: absolute,
        dir,
        catalog: {
          ...(section["builtin"] !== undefined
            ? { builtin: Boolean(section["builtin"]) }
            : {}),
          ...(section["roots"] !== undefined
            ? {
                roots: (section["roots"] as string[]).map((r) =>
                  resolve(dir, r),
                ),
              }
            : {}),
          ...(section["scopes"] !== undefined
            ? { scopes: section["scopes"] as string[] }
            : {}),
          ...(section["workspaces"] !== undefined
            ? {
                workspaces: (section["workspaces"] as string[]).map((w) =>
                  resolve(dir, w),
                ),
              }
            : {}),
          ...(section["packages"] !== undefined
            ? {
                packages: (section["packages"] as string[]).map((p) =>
                  resolve(dir, p),
                ),
              }
            : {}),
          ...(marketplaces ? { marketplaces } : {}),
        },
        raw,
      };
    } catch {
      throw error;
    }
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
  const cfg = configFrom(context);
  const config = cfg?.catalog ?? {};
  const rootDir = cfg?.dir ?? context.cwd;

  const pick = (flag: string, fromFile: readonly unknown[] | undefined) => {
    const given = many(context.args, flag);
    return given.length > 0 ? given : (fromFile ?? []);
  };
  const scopes = pick("scope", config.scopes) as string[];

  const catalogSection = cfg?.raw?.["catalog"] as
    Record<string, unknown> | undefined;
  const rawCatalogMarketplaces =
    catalogSection?.["marketplaces"] ??
    (Array.isArray(cfg?.raw?.["marketplaces"])
      ? cfg?.raw?.["marketplaces"]
      : undefined) ??
    config.marketplaces;

  const marketplacesInput = pick(
    "marketplace",
    rawCatalogMarketplaces as readonly unknown[] | undefined,
  );
  const selectedMarketplaces: string[] = [];

  for (const item of marketplacesInput) {
    const resolved = resolveMarketplaceEntry(
      item as string | readonly string[],
      rootDir,
      cfg?.path,
    );
    if (resolved.isAlternative) {
      if (resolved.found) {
        selectedMarketplaces.push(resolved.chosen);
      } else {
        onReject?.({
          path: resolved.chosen,
          reason: "No supported native marketplace.json found",
        });
        selectedMarketplaces.push(resolved.chosen);
      }
    } else {
      selectedMarketplaces.push(resolved.chosen);
    }
  }

  if (!context.args.flags.has("no-builtin") && config.builtin !== false)
    selectedMarketplaces.push(publicMarketplaceRoot());
  const packages = pick("package", config.packages) as string[];
  const workspaces = pick("workspace", config.workspaces) as string[];
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

export const rootsCommand: Command = {
  name: "roots",
  describe: "Print catalog roots and selected marketplace paths",
  usage: "pmcp roots [--marketplace <dir>] [--json]",
  options: [...CATALOG_OPTIONS, jsonOption],
  run(context) {
    const options = catalogOptionsFrom(context);
    const roots = rootsFrom(context);
    if (context.args.flags.has("json")) {
      context.ui.data(
        JSON.stringify(
          {
            roots,
            marketplaces: options.marketplaces ?? [],
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      for (const r of roots) context.ui.line(`root: ${r}`);
      for (const m of options.marketplaces ?? [])
        context.ui.line(`marketplace: ${m}`);
    }
    return EXIT.ok;
  },
};
