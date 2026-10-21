import type { OptionSpec } from "../../cli/command.js";

export const configOption: OptionSpec = {
  name: "config",
  describe: "Project pmcp.toml",
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
  describe: "Print the documented versioned JSON schema.",
  boolean: true,
};
