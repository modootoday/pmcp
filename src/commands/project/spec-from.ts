import { ArgumentError, type CommandContext } from "../../cli/command.js";
import { readSpec, type ProjectSpec } from "../../project/spec.js";
import { configFrom } from "../config-from.js";

export function specFrom(context: CommandContext): ProjectSpec {
  const config = configFrom(context);
  if (config === null) {
    throw new ArgumentError(
      "no pmcp.toml at or above this directory; pass --config <file>",
    );
  }
  try {
    return readSpec(config);
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}
