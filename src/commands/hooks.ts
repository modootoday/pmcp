import {
  ArgumentError,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { hooksSpec } from "./specs/inspection.js";
async function run(context: CommandContext): Promise<number> {
  const [verb = "list", ...extra] = context.args.positional;
  if (extra.length) throw new ArgumentError("Use hooks list or hooks test");
  if (verb === "list") return (await import("./hooks/list.js")).run(context);
  if (verb === "test") return (await import("./hooks/test.js")).run(context);
  throw new ArgumentError("Use hooks list or hooks test");
}
export const hooksCommand: Command = { ...hooksSpec, run };
