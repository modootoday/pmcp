import type { OptionSpec } from "../../cli/command.js";

export const CATALOG_OPTIONS: readonly OptionSpec[] = [
  {
    name: "root",
    describe: "A node_modules directory to walk. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "scope",
    describe: "Only packages whose names start with this. Repeatable.",
    repeat: true,
    placeholder: "<prefix>",
  },
  {
    name: "no-builtin",
    describe: "Exclude the bundled free PMCP marketplace.",
    boolean: true,
  },
  {
    name: "marketplace",
    describe:
      "An installed local Claude, Codex or Grok marketplace directory. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "package",
    describe:
      "A package directory read directly, for one no node_modules links; without a package.json its folder name is the package name. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "workspace",
    describe:
      "A workspace root, or a glob of them: each root and every member its workspaces globs name. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "config",
    describe:
      "A pmcp.toml to read instead of the nearest one at or above the working directory.",
    placeholder: "<file>",
  },
  {
    name: "no-config",
    describe: "Ignore pmcp.toml; CLI defaults and the given flags apply.",
    boolean: true,
  },
];
