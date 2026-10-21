import type { OptionSpec } from "../../cli/command.js";

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
