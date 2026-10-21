import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ArgumentError, one, type CommandContext } from "../cli/command.js";
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

export { REMOTE_OPTIONS } from "./options/remote.js";

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
  const explicit = one(context.args, "project");
  if (explicit) return resolve(context.cwd, explicit);
  let directory = resolve(context.cwd);
  for (;;) {
    if (existsSync(join(directory, "package.json"))) return directory;
    if (existsSync(join(directory, ".git")) || dirname(directory) === directory)
      throw new ArgumentError(
        "No project package.json found; provide --project",
      );
    directory = dirname(directory);
  }
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
