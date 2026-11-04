import type { CommandSpec } from "../../cli/command.js";

export const marketplaceSpec: CommandSpec = {
  name: "marketplace",
  examples: [
    "pmcp marketplace list",
    "pmcp marketplace export typescript-5 --runtime agy --output ./typescript-plugin",
  ],
  subcommands: [
    {
      name: "list",
      describe: "The bundled free plugins",
      usage: "pmcp marketplace list [--json]",
      options: ["json"],
      examples: ["pmcp marketplace list --json"],
    },
    {
      name: "export",
      describe: "Write one plugin in a runtime's native format",
      usage:
        "pmcp marketplace export <plugin> --runtime <runtime> --output <directory> [--json]",
      options: ["runtime", "output", "json"],
      examples: [
        "pmcp marketplace export typescript-5 --runtime claude --output ./ts-plugin",
      ],
    },
  ],
  describe: "List free public plugins or export a selected native plugin",
  usage: "pmcp marketplace <subcommand> [options]",
  options: [
    {
      name: "runtime",
      describe: "Native plugin format: claude, codex, gemini, grok or agy.",
      placeholder: "<runtime>",
    },
    {
      name: "output",
      describe:
        "New directory for the selected plugin; existing paths are preserved.",
      placeholder: "<directory>",
    },
    {
      name: "json",
      describe: "Print the result as one JSON envelope on stdout.",
      boolean: true,
    },
  ],
};
