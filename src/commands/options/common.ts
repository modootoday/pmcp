import type { OptionSpec } from "../../cli/command.js";

// The options several commands share keep one name, one meaning and one help line here.
export const configOption: OptionSpec = {
  name: "config",
  describe: "A pmcp.toml to read instead of the nearest one.",
  placeholder: "<file>",
};

export const jsonOption: OptionSpec = {
  name: "json",
  describe: "Print the result as one JSON envelope on stdout.",
  boolean: true,
};

// --dry-run always writes nothing; each command says what it would have done.
export function dryRunOption(describe: string): OptionSpec {
  return { name: "dry-run", describe, boolean: true };
}
