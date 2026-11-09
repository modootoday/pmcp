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
  examples: [
    "pmcp sessions",
    'pmcp sessions broadcast "main moved; rebase before delivering"',
  ],
  subcommands: [
    {
      name: "status",
      describe: "Live sessions, pause, broadcasts and leases",
      usage: "pmcp sessions [status] [--json]",
      options: ["config", "json"],
      examples: ["pmcp sessions status --json"],
    },
    {
      name: "pause",
      describe: "Refuse edits in every other session until resume",
      usage: "pmcp sessions pause <reason> [--by <name>]",
      options: ["by", "config"],
      examples: ['pmcp sessions pause "release freeze"'],
    },
    {
      name: "resume",
      describe: "Lift the pause",
      usage: "pmcp sessions resume",
      options: ["config"],
      examples: ["pmcp sessions resume"],
    },
    {
      name: "broadcast",
      describe: "Deliver a note once to every session",
      usage: "pmcp sessions broadcast <text> [--by <name>]",
      options: ["by", "config"],
      examples: ['pmcp sessions broadcast "main moved"'],
    },
    {
      name: "unbroadcast",
      describe: "Withdraw the broadcasts",
      usage: "pmcp sessions unbroadcast",
      options: ["config"],
      examples: ["pmcp sessions unbroadcast"],
    },
    {
      name: "sweep",
      describe: "Remove records whose process is gone",
      usage: "pmcp sessions sweep",
      options: ["config"],
      examples: ["pmcp sessions sweep"],
    },
    {
      name: "send",
      describe: "Send a message to sessions",
      usage:
        "pmcp sessions send --to <selector>... [--subject <s>] [--ttl <minutes>] [--once] [--wake] [--reply-to <id>] <body|->",
      options: [
        "to",
        "subject",
        "ttl",
        "once",
        "wake",
        "reply-to",
        "by",
        "session",
        "config",
        "json",
      ],
      examples: [
        'pmcp sessions send --to role:reviewer --subject review "please look at 4f92"',
      ],
    },
    {
      name: "inbox",
      describe: "List your messages",
      usage: "pmcp sessions inbox [--all] [--session <id>] [--json]",
      options: ["all", "session", "config", "json"],
      examples: ["pmcp sessions inbox --all"],
    },
    {
      name: "ack",
      describe: "Acknowledge messages by id",
      usage: "pmcp sessions ack <id>... [--session <id>]",
      options: ["session", "config", "json"],
      examples: ["pmcp sessions ack 01J9Z"],
    },
    {
      name: "reply",
      describe: "Answer a message",
      usage: "pmcp sessions reply <id> <body|->",
      options: ["session", "by", "config", "json"],
      examples: ['pmcp sessions reply 01J9Z "done"'],
    },
  ],
  defaultSubcommand: "status",
  describe:
    "Show and coordinate the live sessions of this workspace: pause, broadcast, sweep",
  usage: "pmcp sessions [<subcommand>] [options]",
  options: [
    jsonOption,
    nearestConfigOption,
    {
      name: "by",
      describe:
        "Who pauses, broadcasts or sends; that session is exempt. Default: the agent session this runs in; operator only from the operator's terminal.",
      placeholder: "<name>",
    },
    {
      name: "to",
      describe:
        "Message recipients: all, session:<id>, alias:<name>, role:<name> or worktree:<path> (desk:<path> also works). Repeatable.",
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
