import {
  ArgumentError,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import {
  JSON_VERBS,
  SESSION_VERBS,
  sessionsSpec,
} from "../commands/specs/sessions.js";

async function run(context: CommandContext): Promise<number> {
  const verb = context.args.positional[0] ?? "status";
  if (!(SESSION_VERBS as readonly string[]).includes(verb))
    throw new ArgumentError(
      `unknown verb ${verb}; use ${SESSION_VERBS.join(", ")}`,
    );
  if (verb === "status")
    return (await import("./cli/status.js")).status(context);
  if (context.args.flags.has("json") && !JSON_VERBS.includes(verb))
    throw new ArgumentError(`--json works with ${JSON_VERBS.join(", ")}`);
  if (["send", "inbox", "ack", "reply"].includes(verb)) {
    const mailbox = await import("./cli/mailbox.js");
    if (verb === "send") return mailbox.send(context);
    if (verb === "inbox") return mailbox.inbox(context);
    if (verb === "ack") return mailbox.ack(context);
    return mailbox.reply(context);
  }
  if (verb === "pause") return (await import("./cli/pause.js")).run(context);
  if (verb === "resume") return (await import("./cli/resume.js")).run(context);
  if (verb === "broadcast")
    return (await import("./cli/broadcast.js")).run(context);
  if (verb === "unbroadcast")
    return (await import("./cli/unbroadcast.js")).run(context);
  return (await import("./cli/sweep.js")).run(context);
}

export const sessionsCommand: Command = { ...sessionsSpec, run };
