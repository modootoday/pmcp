import {
  ArgumentError,
  unknownSubcommand,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { hooksSpec } from "./specs/inspection.js";

const VERBS = ["list", "test", "report"];

async function run(context: CommandContext): Promise<number> {
  const [verb = "list", ...extra] = context.args.positional;
  if (!VERBS.includes(verb)) throw unknownSubcommand("hooks", verb, VERBS);
  if (extra.length) throw new ArgumentError(`unexpected ${extra.join(" ")}`);
  if (verb === "list") return (await import("./hooks/list.js")).run(context);
  if (verb === "test") return (await import("./hooks/test.js")).run(context);
  return (await import("./hooks/report.js")).run(context);
}
export const hooksCommand: Command = { ...hooksSpec, run };
