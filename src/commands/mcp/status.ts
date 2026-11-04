import type { CommandContext } from "../../cli/command.js";
import { status } from "../../mcp-auth/status.js";
import { serverFrom } from "./server.js";

export function run(context: CommandContext): number {
  const { name, url } = serverFrom(context);
  const result = status(name, url, context.env);
  if (context.args.flags.has("json")) {
    context.ui.data(JSON.stringify({ version: 1, name, ...result }) + "\n");
    return 0;
  }
  const expiry = result.expiresAt ? `; expires ${result.expiresAt}` : "";
  const scopes = result.scopes.length
    ? `; scopes ${result.scopes.join(" ")}`
    : "";
  context.ui.results.line(
    `${name}: ${result.present ? "signed in" : "not signed in"}${expiry}${scopes}`,
  );
  return 0;
}
