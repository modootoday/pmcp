import {
  ArgumentError,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { hooksSpec } from "./specs/inspection.js";
async function run(context: CommandContext): Promise<number> {
  const [verb = "list", ...extra] = context.args.positional;
  const usage = "Use hooks list, hooks test or hooks report";
  if (extra.length) throw new ArgumentError(usage);
  if (verb === "list") return (await import("./hooks/list.js")).run(context);
  if (verb === "test") return (await import("./hooks/test.js")).run(context);
  if (verb === "report")
    return (await import("./hooks/report.js")).run(context);
  throw new ArgumentError(usage);
}
export const hooksCommand: Command = { ...hooksSpec, run };
