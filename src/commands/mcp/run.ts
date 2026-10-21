import { ArgumentError, type CommandContext } from "../../cli/command.js";

export async function executeMcpCommand(
  context: CommandContext,
): Promise<number> {
  const [verb, name, ...extra] = context.args.positional;
  if (
    !name ||
    extra.length ||
    !["login", "logout", "status"].includes(verb ?? "")
  )
    throw new ArgumentError("Use pmcp mcp <login|logout|status> <name>");
  if (context.args.flags.has("json") && verb !== "status")
    throw new ArgumentError("--json requires mcp status");
  if (verb === "status") return (await import("./status.js")).run(context);
  if (verb === "logout") return (await import("./logout.js")).run(context);
  return (await import("./start-login.js")).run(context);
}
