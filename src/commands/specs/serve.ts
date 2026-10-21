import type { CommandSpec } from "../../cli/command.js";
import { CATALOG_OPTIONS } from "../options/catalog.js";
import { EMBEDDING_OPTIONS } from "../options/embedding.js";

export const serveSpec: CommandSpec = {
  name: "serve",
  describe: "Run the MCP server on stdio (also the default for piped launches)",
  usage:
    "pmcp serve [--root <dir>] [--scope <prefix>] [--marketplace <dir>] [--package <dir>] [--workspace <dir>] [--config <file> | --no-config] [--prompts]",
  options: [
    ...CATALOG_OPTIONS,
    ...EMBEDDING_OPTIONS,
    {
      name: "lexical",
      describe: "Skip semantic index and model loading",
      boolean: true,
    },
    {
      name: "mailbox-actor-file",
      describe: "Private launcher actor credential for opt-in mailbox",
      placeholder: "<file>",
    },
    {
      name: "mailbox-binding-file",
      describe: "Private attachment file written by the launcher",
      placeholder: "<file>",
    },
    {
      name: "mailbox-runtime",
      describe: "Launcher-assigned canonical runtime",
      placeholder: "<runtime>",
    },
    {
      name: "mailbox-replace-session",
      describe: "Exact old attachment ID to replace",
      placeholder: "<id>",
    },
    {
      name: "mailbox-native-session",
      describe: "Launcher-owned native session ID",
      placeholder: "<id>",
    },
    {
      name: "prompts",
      describe:
        "Also offer one prompt per skill, for hosts that turn prompts into commands.",
      boolean: true,
    },
  ],
};
