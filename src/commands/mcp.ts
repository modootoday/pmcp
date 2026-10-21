import type { Command, CommandContext } from "../cli/command.js";
import { mcpSpec } from "./specs/mcp.js";

async function run(context: CommandContext): Promise<number> {
  const { executeMcpCommand } = await import("./mcp/run.js");
  return executeMcpCommand(context);
}

export const mcpCommand: Command = { ...mcpSpec, run };
