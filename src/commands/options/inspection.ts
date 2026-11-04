import type { OptionSpec } from "../../cli/command.js";

export const configOption: OptionSpec = {
  name: "config",
  describe: "A pmcp.toml to read instead of the nearest one.",
  placeholder: "<file>",
};
// The commands that otherwise find the nearest pmcp.toml themselves.
export const nearestConfigOption: OptionSpec = {
  name: "config",
  describe: "A pmcp.toml to read instead of the nearest one.",
  placeholder: "<file>",
};
export const jsonOption: OptionSpec = {
  name: "json",
  describe: "Print the result as one JSON envelope on stdout.",
  boolean: true,
};
