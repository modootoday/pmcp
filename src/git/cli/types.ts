import type { CommandContext } from "../../cli/command.js";
import type { GitSetup } from "../setup.js";
import type { Reporter } from "../types.js";

export type Action = (
  setup: GitSetup,
  context: CommandContext,
  report: Reporter,
) => number;

export function off(table: string): never {
  throw new Error(
    `[${table}] is absent from pmcp.toml, so this command is off`,
  );
}
