import type { CommandContext } from "../../cli/command.js";
import { execMcp } from "../../project/mcp-env.js";
import { specFrom } from "./spec-from.js";

export function runExecMcp(
  context: CommandContext,
  name: string,
): Promise<number> {
  return execMcp(specFrom(context), name, context.env);
}
