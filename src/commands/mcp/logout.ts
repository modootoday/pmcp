import type { CommandContext } from "../../cli/command.js";
import { logout } from "../../mcp-auth/session.js";
import { serverFrom } from "./server.js";

export async function run(context: CommandContext): Promise<number> {
  const { name, url } = serverFrom(context);
  await logout(name, url, context.env);
  context.ui.success("MCP credentials cleared for " + name);
  return 0;
}
