import type { CommandSpec } from "../../cli/command.js";
import { jsonOption, nearestConfigOption } from "../options/inspection.js";

export const SESSION_VERBS = [
  "status",
  "pause",
  "resume",
  "broadcast",
  "unbroadcast",
  "sweep",
  "send",
  "inbox",
  "ack",
  "reply",
] as const;

// Verbs that print data and so accept --json.
export const JSON_VERBS: readonly string[] = [
  "status",
  "send",
  "inbox",
  "ack",
  "reply",
];

export const sessionsSpec: CommandSpec = {
  name: "sessions",
  describe:
    "Show and coordinate the live sessions of this workspace: pause, broadcast, sweep",
  usage:
    "pmcp sessions status | pause <reason> [--by <name>] | resume | broadcast <text> [--by <name>] | unbroadcast | sweep | send --to <selector>... [--subject <s>] [--ttl <minutes>] [--once] [--reply-to <id>] <body|-> | inbox [--all] | ack <id>... | reply <id> <body|->",
  options: [
    jsonOption,
    nearestConfigOption,
    {
      name: "by",
      describe:
        "Who pauses, broadcasts or sends; that session is exempt. Default operator.",
      placeholder: "<name>",
    },
    {
      name: "to",
      describe:
        "Message recipients: all, session:<id>, alias:<name>, role:<name> or desk:<path>. Repeatable.",
      placeholder: "<selector>",
      repeat: true,
    },
    { name: "subject", describe: "Message subject.", placeholder: "<text>" },
    {
      name: "ttl",
      describe:
        "Minutes until the message expires; default [sessions.mailbox] ttl_minutes.",
      placeholder: "<minutes>",
    },
    {
      name: "once",
      describe: "Mark the message a one-time request, not a standing rule.",
      boolean: true,
    },
    {
      name: "wake",
      describe:
        "Also start a turn in idle recipients where the runtime allows it (Claude, opencode).",
      boolean: true,
    },
    {
      name: "reply-to",
      describe: "The message this one answers.",
      placeholder: "<id>",
    },
    {
      name: "session",
      describe:
        "Whose inbox: the session id that reads, sends or acknowledges.",
      placeholder: "<id>",
    },
    {
      name: "all",
      describe: "List every unexpired message, not only yours.",
      boolean: true,
    },
  ],
};
