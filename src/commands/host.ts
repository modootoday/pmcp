import {
  ArgumentError,
  one,
  unknownSubcommand,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { hostSpec } from "./specs/host.js";

// Each io verb loads on its own: plan and doctor only read, measure brings the probe.
async function run(context: CommandContext): Promise<number> {
  const [area, verb, extra] = context.args.positional;
  const probe = one(context.args, "probe");
  if (probe !== undefined)
    return (await import("../host/io/jobs.js")).runJob(probe);
  if (area !== "io") throw unknownSubcommand("host", area, ["io"]);
  const verbs = ["measure", "plan", "doctor"];
  if (verb === undefined || !verbs.includes(verb))
    throw unknownSubcommand("host io", verb, verbs);
  if (extra !== undefined) throw new ArgumentError(`unexpected ${extra}`);
  if (verb === "measure")
    return (await import("../host/io/cli/measure.js")).ioMeasure(context);
  if (verb === "plan")
    return (await import("../host/io/cli/plan.js")).ioPlanCommand(context);
  return (await import("../host/io/cli/doctor.js")).ioDoctor(context);
}

export const hostCommand: Command = { ...hostSpec, run };
