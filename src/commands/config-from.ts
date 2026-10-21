import { ArgumentError, one, type CommandContext } from "../cli/command.js";
import {
  ConfigError,
  findConfig,
  readConfig,
  type ProjectConfig,
} from "../config.js";

// Fail on missing explicit configuration so a path typo cannot silently select defaults.
export function configFrom(context: CommandContext): ProjectConfig | null {
  if (context.args.flags.has("no-config")) return null;
  const named = one(context.args, "config");
  const path = named ?? findConfig(context.cwd);
  if (path === null) return null;
  try {
    return readConfig(path);
  } catch (error) {
    if (error instanceof ConfigError) throw new ArgumentError(error.message);
    if (named !== undefined) throw new ArgumentError(`cannot read ${named}`);
    throw error;
  }
}
