import {
  ArgumentError,
  EXIT,
  many,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import {
  CONDITION_FORMS,
  parseCondition,
  waitFor,
  type Condition,
} from "../lease/wait.js";
import { waitSpec } from "./specs/wait.js";

function seconds(context: CommandContext, name: string, fallback: number) {
  const text = one(context.args, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!(value > 0))
    throw new ArgumentError(`--${name} must be a positive number`);
  return value;
}

function conditions(context: CommandContext): Condition[] {
  const found: Condition[] = [];
  for (const text of many(context.args, "pid")) {
    const pid = Number(text);
    if (!Number.isInteger(pid) || pid <= 0)
      throw new ArgumentError(`--pid ${text} is not a process id`);
    found.push({ kind: "pid", pid });
  }
  for (const text of many(context.args, "until")) {
    const condition = parseCondition(text);
    if (condition === null)
      throw new ArgumentError(`--until ${text}: use ${CONDITION_FORMS}`);
    found.push(condition);
  }
  if (found.length === 0) throw new ArgumentError("name --pid or --until");
  if (context.args.positional.length > 0)
    throw new ArgumentError(`unexpected ${context.args.positional[0]}`);
  return found;
}

async function run(context: CommandContext): Promise<number> {
  const timeout = seconds(context, "timeout", 3600);
  const met = await waitFor({
    conditions: conditions(context),
    timeout,
    interval: seconds(context, "interval", 5),
    ...(context.env["PMCP_HEAVY_LOADAVG_FILE"]
      ? { loadavg: context.env["PMCP_HEAVY_LOADAVG_FILE"] }
      : {}),
    say: (line) => context.ui.info(line),
  });
  if (met) return EXIT.ok;
  context.ui.error(`not met within ${timeout}s`);
  return EXIT.busy;
}

export const waitCommand: Command = { ...waitSpec, run };
