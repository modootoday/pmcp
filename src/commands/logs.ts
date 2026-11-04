import { noConfig, type Command, type CommandContext } from "../cli/command.js";
import { runLogs } from "../logging/cli.js";
import { pruneLogs } from "../logging/sinks/file.js";
import { logLocation } from "../project/log-location.js";
import { configFrom } from "./config-from.js";
import { logsSpec } from "./specs/logs.js";

function run(context: CommandContext): Promise<number> {
  const config = configFrom(context);
  if (!config) throw noConfig();
  const location = logLocation(config, context.env);
  if (!context.args.flags.has("json") && !location.file)
    pruneLogs(location.dir, location.keepDays);
  return runLogs(context, location);
}
export const logsCommand: Command = { ...logsSpec, run };
