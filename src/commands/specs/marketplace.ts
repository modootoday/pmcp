import type { CommandSpec } from "../../cli/command.js";

export const marketplaceSpec: CommandSpec = {
  name: "marketplace",
  describe: "List free public plugins or export a selected native plugin",
  usage:
    "pmcp marketplace list | export <plugin> --runtime <runtime> --output <directory> [--json]",
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
      describe: "Print machine-readable results.",
      boolean: true,
    },
  ],
};
