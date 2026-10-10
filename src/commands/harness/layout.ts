import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import {
  planLayout,
  type TerminalLayout,
} from "../../harness/terminal/layout.js";

function dimension(context: CommandContext, name: string): number {
  const value = one(context.args, name);
  if (value === undefined || !/^\d+$/.test(value))
    throw new ArgumentError(`Provide --${name} as an integer`);
  return Number(value);
}

export function runLayout(context: CommandContext): number {
  if (context.args.positional.length !== 1)
    throw new ArgumentError("Provide only layout");
  for (const option of [
    ...context.args.options.keys(),
    ...context.args.flags,
  ]) {
    if (option !== "columns" && option !== "rows")
      throw new ArgumentError(`--${option} is not supported by layout`);
  }
  let layout: TerminalLayout;
  try {
    layout = planLayout(
      dimension(context, "columns"),
      dimension(context, "rows"),
    );
  } catch (error) {
    if (error instanceof RangeError) throw new ArgumentError(error.message);
    throw error;
  }
  context.ui.data(`${JSON.stringify(layout, null, 2)}\n`);
  return 0;
}
