import {
  ArgumentError,
  EXIT,
  noConfig,
  type CommandContext,
} from "../cli/command.js";
import { configFrom } from "../commands/config-from.js";
import { readStatus } from "./read.js";
import { renderStatus } from "./render.js";

export async function run(context: CommandContext): Promise<number> {
  if (context.args.positional.length)
    throw new ArgumentError("Use status [--json]");
  const config = configFrom(context);
  if (!config) throw noConfig();
  const report = await readStatus(config, context.env);
  if (context.args.flags.has("json"))
    context.ui.data(JSON.stringify(report) + "\n");
  if (!context.args.flags.has("json")) renderStatus(context, report);
  return report.drift ? EXIT.differences : EXIT.ok;
}
