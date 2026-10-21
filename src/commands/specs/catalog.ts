import type { CommandSpec } from "../../cli/command.js";
import { CATALOG_OPTIONS } from "../options/catalog.js";
import { EMBEDDING_OPTIONS } from "../options/embedding.js";

export const listSpec: CommandSpec = {
  name: "list",
  describe: "List the skills discovered in node_modules and marketplaces",
  usage:
    "pmcp list [--root <dir>] [--scope <prefix>] [--marketplace <dir>] [--package <dir>] [--workspace <dir|glob>] [--config <file> | --no-config] [--json]",
  options: [
    ...CATALOG_OPTIONS,
    { name: "json", describe: "Emit JSON rather than a table.", boolean: true },
  ],
};

export const indexSpec: CommandSpec = {
  name: "index",
  describe: "Encode the catalog so ranking can be semantic",
  usage: "pmcp index [--root <dir>] [--model <id>]",
  options: [
    ...CATALOG_OPTIONS,
    ...EMBEDDING_OPTIONS,
    { name: "local-only", describe: "Refuse model downloads", boolean: true },
    {
      name: "force",
      describe: "Re-encode the selected model even when descriptions match",
      boolean: true,
    },
    {
      name: "json",
      describe: "Emit JSON rather than a summary.",
      boolean: true,
    },
    {
      name: "dry-run",
      describe: "Report what would be encoded and write nothing.",
      boolean: true,
    },
  ],
};

export const modelsSpec: CommandSpec = {
  name: "models",
  describe: "List embedding presets without loading or downloading models",
  usage: "pmcp models [--json]",
  options: [
    { name: "json", describe: "Emit preset metadata as JSON", boolean: true },
  ],
};

export const validateSpec: CommandSpec = {
  name: "validate",
  describe:
    "Check skills against the Agent Skills specification: given directories, or every skill the catalog reaches",
  usage:
    "pmcp validate [<skill-dir>...] [--root <dir>] [--marketplace <dir>] [--package <dir>] [--workspace <dir>] [--config <file> | --no-config] [--json]",
  options: [
    ...CATALOG_OPTIONS,
    { name: "json", describe: "Emit JSON rather than a table.", boolean: true },
  ],
};
