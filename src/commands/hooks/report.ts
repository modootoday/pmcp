import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import {
  guardLines,
  readReportTable,
  report,
  wouldRefuse,
} from "../../hooks/inspection/report.js";
import { parseSince, readLogs } from "../../logging/query.js";
import { logLocation } from "../../project/log-location.js";
import { configFrom } from "../config-from.js";

export async function run(context: CommandContext): Promise<number> {
  const config = configFrom(context);
  if (!config)
    throw new ArgumentError("no pmcp.toml here or above; pass --config");
  const hooks = (config.raw.hooks ?? {}) as Record<string, unknown>;
  let settings;
  let since: Date | undefined;
  try {
    settings = readReportTable(hooks["report"]);
    const value = one(context.args, "since");
    if (value !== undefined) since = parseSince(value);
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const location = logLocation(config, context.env);
  const logged = readLogs(
    location.dir,
    { component: "hooks.entry", ...(since ? { since } : {}) },
    location.file,
  );
  const { kept, excluded } = guardLines(logged, settings);
  const guard = one(context.args, "switch-check");
  const json = context.args.flags.has("json");
  if (guard !== undefined) {
    const found = wouldRefuse(kept, guard);
    if (json)
      context.ui.data(
        JSON.stringify({ version: 1, guard, refused: found }) + "\n",
      );
    else {
      for (const line of found)
        context.ui.line(
          [
            line.ts,
            line.runtime,
            line.session.slice(0, 8),
            `${line.mode}: ${line.raw} -> ${line.verdict}`,
            line.tool ?? "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      context.ui.line(
        `${guard} would have refused ${found.length} call(s) it let through`,
      );
    }
    return 0;
  }
  const summary = report(kept, excluded);
  if (json) {
    context.ui.data(
      JSON.stringify({
        version: 1,
        ...(since ? { since: since.toISOString() } : {}),
        ...summary,
      }) + "\n",
    );
    return 0;
  }
  if (summary.lines === 0)
    context.ui.line(
      "no guard log lines; guards log at debug level ([logging] level or PMCP_LOG=debug)",
    );
  for (const row of summary.guards) {
    const counts = (values: Readonly<Record<string, number>>) =>
      Object.entries(values)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => `${name} ${value}`)
        .join(", ");
    context.ui.line(
      `${row.policy} ${row.runtime} [${row.modes.join(",")}]: ${row.calls} call(s), ${row.sessions} session(s); found ${counts(row.raw)}; gave ${counts(row.verdict)}; p50 ${row.durationMs.p50}ms p95 ${row.durationMs.p95}ms max ${row.durationMs.max}ms`,
    );
  }
  context.ui.line(
    `${summary.lines} guard run(s) in ${summary.sessions} session(s)${summary.excluded ? `; ${summary.excluded} excluded by [hooks.report] exclude_sessions` : ""}`,
  );
  return 0;
}
