import type { OptionSpec } from "../../cli/command.js";

export const tuiOptions: readonly OptionSpec[] = [
  {
    name: "json",
    describe: "Print the result as one JSON envelope on stdout.",
    boolean: true,
  },
  {
    name: "memory-mb",
    describe: "Worker memory reservation",
    placeholder: "<count>",
  },
  {
    name: "config",
    describe: "A pmcp.toml to read instead of the nearest one.",
    placeholder: "<file>",
  },
  {
    name: "runtime",
    describe: "Native runtime ID for main launch or worker start",
    placeholder: "<runtime>",
  },
  {
    name: "yes",
    describe: "Confirm the first native runtime start",
    boolean: true,
    short: "y",
  },
  {
    name: "new",
    describe: "Create a workspace after the previous group is stopped",
    boolean: true,
  },
];
