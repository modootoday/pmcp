import type { CommandContext } from "../../cli/command.js";
import { status } from "../../mcp-auth/status.js";
import { serverFrom } from "./server.js";

export function run(context: CommandContext): number {
  const { name, url } = serverFrom(context);
  const result = status(name, url, context.env);
  const output = context.args.flags.has("json")
    ? { version: 1, name, ...result }
    : result;
  context.ui.data(JSON.stringify(output) + "\n");
  return 0;
}
