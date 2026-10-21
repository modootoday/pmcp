import { ArgumentError, type CommandContext } from "../../cli/command.js";
import { configFrom } from "../config-from.js";
import { readSpec } from "../../project/spec.js";

export function serverFrom(context: CommandContext) {
  const name = context.args.positional[1]!;
  const config = configFrom(context);
  if (!config)
    throw new ArgumentError("MCP authentication requires a project pmcp.toml");
  const server = readSpec(config).mcp[name];
  if (!server?.url || server.auth !== "pmcp")
    throw new ArgumentError(
      "Select a declared HTTP MCP server with auth = pmcp",
    );
  return { name, server, url: server.url };
}
