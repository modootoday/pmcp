import { noConfig, type Command, type CommandContext } from "../cli/command.js";
import { leaseSettingsFor } from "../lease/config.js";
import { leasePaths } from "../lease/files.js";
import { leaseLogRecords, wantsLease } from "../lease/log-records.js";
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
  // The host lease's records join only a query that names the lease, so a plain pmcp logs
  // stays this project's own view.
  return runLogs(context, location, (filter) => {
    if (!wantsLease(filter)) return [];
    const settings = leaseSettingsFor(context.cwd, config.path);
    return leaseLogRecords(leasePaths(settings.dir));
  });
}
export const logsCommand: Command = { ...logsSpec, run };
