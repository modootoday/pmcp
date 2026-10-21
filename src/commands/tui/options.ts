import type { OptionSpec } from "../../cli/command.js";

export const tuiOptions: readonly OptionSpec[] = [
  {
    name: "memory-mb",
    describe: "Worker memory reservation",
    placeholder: "<count>",
  },
  {
    name: "config",
    describe: "Project pmcp.toml",
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
  },
  {
    name: "new",
    describe: "Create a workspace after the previous group is stopped",
    boolean: true,
  },
];
