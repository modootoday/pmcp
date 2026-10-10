import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  ArgumentError,
  one,
  type CommandContext,
  type OptionSpec,
} from "../cli/command.js";
import {
  DEFAULT_API_ORIGIN,
  fetchCatalog,
  readCatalogFile,
  parseCatalog,
  type RemoteCatalog,
} from "../remote/catalog.js";
import { fileCatalogCache } from "../remote/catalog-cache.js";
import { globalDir } from "../remote/session.js";
import { publicMarketplaceRoot } from "../marketplace/builtin.js";

export const REMOTE_OPTIONS: readonly OptionSpec[] = [
  {
    name: "provider",
    describe: "Public free catalog (default) or explicitly hosted service.",
    placeholder: "<public|hosted>",
  },
  {
    name: "project",
    describe: "Project directory containing package.json.",
    placeholder: "<dir>",
  },
  { name: "api", describe: "Catalog API origin.", placeholder: "<origin>" },
  {
    name: "catalog",
    describe: "Use a saved catalog response without network access.",
    placeholder: "<file>",
  },
  { name: "json", describe: "Print machine-readable results.", boolean: true },
];

export function catalogProvider(context: CommandContext): "public" | "hosted" {
  const given = one(context.args, "provider");
  if (given !== undefined && given !== "public" && given !== "hosted")
    throw new ArgumentError("Choose --provider public or hosted");
  const givenApi = one(context.args, "api");
  const api = givenApi ?? context.env.PMCP_API_ORIGIN;
  if (given === "public" && givenApi)
    throw new ArgumentError(
      "The public provider does not accept a hosted API origin",
    );
  return given ?? (api ? "hosted" : "public");
}

export function projectFrom(context: CommandContext): string {
  return resolve(context.cwd, one(context.args, "project") ?? ".");
}

export function apiOrigin(context: CommandContext): string {
  return (
    one(context.args, "api") ??
    context.env["PMCP_API_ORIGIN"] ??
    DEFAULT_API_ORIGIN
  );
}

export async function remoteCatalog(
  context: CommandContext,
): Promise<RemoteCatalog> {
  const provider = catalogProvider(context);
  const file = one(context.args, "catalog");
  if (file) {
    if (one(context.args, "api"))
      throw new Error("choose --catalog or --api, not both");
    return readCatalogFile(resolve(context.cwd, file));
  }
  if (provider === "public") {
    const catalog: unknown = JSON.parse(
      readFileSync(join(publicMarketplaceRoot(), "docs/catalog.json"), "utf8"),
    );
    return parseCatalog({
      schemaVersion: 1,
      requestId: "bundled-public",
      catalog,
    });
  }
  return fetchCatalog(apiOrigin(context), fetch, fileCatalogCache(globalDir()));
}
