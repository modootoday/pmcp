import {
  ArgumentError,
  EXIT,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { ConfigError } from "../config.js";
import { leaseSettingsFor, type LeaseSettings } from "../lease/config.js";
import { runHeavy } from "../lease/run.js";
import { leaseStatus } from "../lease/status.js";
import { heavySpec } from "./specs/host.js";

function settings(context: CommandContext): LeaseSettings {
  try {
    return leaseSettingsFor(context.cwd, one(context.args, "config"));
  } catch (error) {
    if (error instanceof ConfigError) throw new ArgumentError(error.message);
    throw error;
  }
}

async function run(context: CommandContext): Promise<number> {
  const { args } = context;
  const say = (line: string) => process.stderr.write(`pmcp heavy: ${line}\n`);
  if (args.passthrough === undefined) {
    if (args.positional.length === 1 && args.positional[0] === "status") {
      for (const line of leaseStatus({
        settings: settings(context),
        env: context.env,
      }))
        context.ui.data(`${line}\n`);
      return EXIT.ok;
    }
    throw new ArgumentError(
      "put the command after --, or use pmcp heavy status",
    );
  }
  if (args.passthrough.length === 0)
    throw new ArgumentError("no command after --");
  const lease = settings(context);
  const profile = one(args, "profile") ?? "default";
  if (lease.profiles[profile] === undefined)
    throw new ArgumentError(
      `unknown profile ${profile}; known: ${Object.keys(lease.profiles).join(", ")}`,
    );
  const label = one(args, "label");
  return runHeavy({
    settings: lease,
    profile,
    ...(label ? { label } : {}),
    argv: args.passthrough,
    cwd: context.cwd,
    env: context.env,
    say,
  });
}

export const heavyCommand: Command = { ...heavySpec, run };
