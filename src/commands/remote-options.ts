import { resolve } from "node:path";
import { one, type CommandContext, type OptionSpec } from "../cli/command.js";
import { DEFAULT_API_ORIGIN, fetchCatalog, readCatalogFile, type RemoteCatalog } from "../remote/catalog.js";

export const REMOTE_OPTIONS: readonly OptionSpec[] = [
  { name: "project", describe: "Project directory containing package.json.", placeholder: "<dir>" },
  { name: "api", describe: "Catalog API origin.", placeholder: "<origin>" },
  { name: "catalog", describe: "Use a saved catalog response without network access.", placeholder: "<file>" },
  { name: "json", describe: "Print machine-readable results.", boolean: true },
];

export function projectFrom(context: CommandContext): string {
  return resolve(context.cwd, one(context.args, "project") ?? ".");
}

export function apiOrigin(context: CommandContext): string {
  return one(context.args, "api") ?? context.env["PMCP_API_ORIGIN"] ?? DEFAULT_API_ORIGIN;
}

export async function remoteCatalog(context: CommandContext): Promise<RemoteCatalog> {
  const file = one(context.args, "catalog");
  if (file) {
    if (one(context.args, "api")) throw new Error("choose --catalog or --api, not both");
    return readCatalogFile(resolve(context.cwd, file));
  }
  return fetchCatalog(apiOrigin(context));
}
