import { ArgumentError, one, type CommandContext } from "../cli/command.js";
import { isLogLevel } from "./levels.js";
import {
  matches,
  parseSince,
  pretty,
  readLogs,
  tail,
  type LogFilter,
  type LogLine,
} from "./query.js";

export interface LogLocation {
  readonly dir: string;
  readonly file?: string;
  readonly keepDays: number;
}

function filterFrom(context: CommandContext): LogFilter {
  const level = one(context.args, "level");
  if (level !== undefined && !isLogLevel(level))
    throw new ArgumentError(
      "--level must be error, warn, info, debug or trace",
    );
  const since = one(context.args, "since");
  const pick = (name: string) => one(context.args, name);
  const session = pick("session");
  const trace = pick("trace");
  const component = pick("component");
  try {
    return {
      ...(session ? { session } : {}),
      ...(trace ? { trace } : {}),
      ...(component ? { component } : {}),
      ...(level ? { level } : {}),
      ...(since ? { since: parseSince(since) } : {}),
    };
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runLogs(
  context: CommandContext,
  location: LogLocation,
): Promise<number> {
  const filter = filterFrom(context);
  if (context.args.flags.has("json")) {
    if (context.args.flags.has("follow") || context.args.flags.has("pretty"))
      throw new ArgumentError(
        "--json cannot be combined with --follow or --pretty",
      );
    context.ui.data(
      JSON.stringify({
        version: 1,
        records: readLogs(location.dir, filter, location.file),
      }) + "\n",
    );
    return 0;
  }
  const show = (line: LogLine) =>
    context.ui.data(
      `${context.args.flags.has("pretty") ? pretty(line) : JSON.stringify(line)}\n`,
    );
  readLogs(location.dir, filter, location.file).forEach(show);
  if (!context.args.flags.has("follow")) return 0;
  const state = { file: "", offset: 0 };
  tail(location.dir, state, location.file);
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      tail(location.dir, state, location.file)
        .filter((line) => matches(line, filter))
        .forEach(show);
    }, 500);
    process.once("SIGINT", () => {
      clearInterval(timer);
      resolve();
    });
  });
  return 0;
}
