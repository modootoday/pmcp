import {
  ArgumentError,
  unknownSubcommand,
  type CommandContext,
} from "../../cli/command.js";

const VERBS = ["login", "logout", "status"];

export async function executeMcpCommand(
  context: CommandContext,
): Promise<number> {
  const [verb, name, ...extra] = context.args.positional;
  if (verb === undefined || !VERBS.includes(verb))
    throw unknownSubcommand("mcp", verb, VERBS);
  if (!name) throw new ArgumentError(`mcp ${verb} needs a server name`);
  if (extra.length) throw new ArgumentError(`unexpected ${extra.join(" ")}`);
  if (context.args.flags.has("json") && verb !== "status")
    throw new ArgumentError("--json requires mcp status");
  if (verb === "status") return (await import("./status.js")).run(context);
  if (verb === "logout") return (await import("./logout.js")).run(context);
  return (await import("./start-login.js")).run(context);
}
