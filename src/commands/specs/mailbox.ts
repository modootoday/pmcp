import type { CommandSpec } from "../../cli/command.js";
import { configOption } from "../options/inspection.js";

export const mailboxSpec: CommandSpec = {
  name: "mailbox",
  protocol: true,
  describe: "Manage opt-in local peer mail and launcher credentials",
  usage: "pmcp mailbox <subcommand> [options]",
  subcommands: [
    {
      name: "init",
      describe: "Create the project UUID and mailbox state",
      usage: "pmcp mailbox init [--config <file>] [--state-dir <dir>]",
      options: ["config", "state-dir"],
      examples: ["pmcp mailbox init --config ./pmcp.toml"],
    },
    {
      name: "actor",
      describe: "Register an actor and write its private credential",
      usage:
        "pmcp mailbox actor --actor <id> --actor-file <file> [--parent-binding <file>]",
      options: ["config", "actor", "actor-file", "parent-binding"],
      examples: [
        "pmcp mailbox actor --actor reviewer --actor-file /private/reviewer.actor.json",
      ],
    },
    {
      name: "rotate",
      describe: "Replace an actor's credential (administration)",
      usage: "pmcp mailbox rotate --actor <id> --actor-file <file> --operator",
      options: ["config", "actor", "actor-file", "operator"],
      examples: [
        "pmcp mailbox rotate --actor reviewer --actor-file /private/reviewer.actor.json --operator",
      ],
    },
    {
      name: "send",
      describe: "Send a message from --input as the actor",
      usage:
        "pmcp mailbox send --actor-file <file> --binding-file <file> --input <file>",
      options: ["config", "actor-file", "binding-file", "input"],
      examples: [
        "pmcp mailbox send --actor-file a.json --binding-file b.json --input message.json",
      ],
    },
    {
      name: "inbox",
      describe: "List the actor's messages",
      usage:
        "pmcp mailbox inbox --actor-file <file> --binding-file <file> [--input <file>]",
      options: ["config", "actor-file", "binding-file", "input"],
      examples: [
        "pmcp mailbox inbox --actor-file a.json --binding-file b.json",
      ],
    },
    {
      name: "read",
      describe: "Read a message and record a receipt",
      usage:
        "pmcp mailbox read --actor-file <file> --binding-file <file> --input <file>",
      options: ["config", "actor-file", "binding-file", "input"],
      examples: [
        "pmcp mailbox read --actor-file a.json --binding-file b.json --input read.json",
      ],
    },
    {
      name: "ack",
      describe: "Acknowledge a read message",
      usage:
        "pmcp mailbox ack --actor-file <file> --binding-file <file> --input <file>",
      options: ["config", "actor-file", "binding-file", "input"],
      examples: [
        "pmcp mailbox ack --actor-file a.json --binding-file b.json --input ack.json",
      ],
    },
    {
      name: "sessions",
      describe: "List attached sessions",
      usage: "pmcp mailbox sessions --actor-file <file> --binding-file <file>",
      options: ["config", "actor-file", "binding-file"],
      examples: [
        "pmcp mailbox sessions --actor-file a.json --binding-file b.json",
      ],
    },
    {
      name: "export",
      describe: "Export correspondence (administration)",
      usage:
        "pmcp mailbox export --operator --output <file> [--scope-actor <id>]",
      options: ["config", "operator", "output", "scope-actor"],
      examples: ["pmcp mailbox export --operator --output mail-export.json"],
    },
    {
      name: "backup",
      describe: "Back the mailbox state up (administration)",
      usage: "pmcp mailbox backup --operator --output <file>",
      options: ["config", "operator", "output"],
      examples: ["pmcp mailbox backup --operator --output mail.backup"],
    },
    {
      name: "restore",
      describe: "Restore a backup (administration)",
      usage: "pmcp mailbox restore --operator --input <file> --output <file>",
      options: ["config", "operator", "input", "output"],
      examples: [
        "pmcp mailbox restore --operator --input mail.backup --output restored",
      ],
    },
  ],
  examples: [
    "pmcp mailbox init --config ./pmcp.toml",
    "pmcp mailbox actor --actor reviewer --actor-file /private/reviewer.actor.json",
  ],
  options: [
    configOption,
    {
      name: "state-dir",
      describe: "Private mailbox state directory",
      placeholder: "<dir>",
    },
    { name: "actor", describe: "Registered actor ID", placeholder: "<id>" },
    {
      name: "actor-file",
      describe: "Private actor credential file",
      placeholder: "<file>",
    },
    {
      name: "binding-file",
      describe: "Private existing attachment file",
      placeholder: "<file>",
    },
    {
      name: "parent-binding",
      describe: "Live parent attachment for bounded child delegation",
      placeholder: "<file>",
    },
    {
      name: "input",
      describe: "Operation input JSON or backup source",
      placeholder: "<file>",
    },
    {
      name: "output",
      describe: "New export or backup destination",
      placeholder: "<file>",
    },
    {
      name: "scope-actor",
      describe: "Limit export to one actor's correspondence",
      placeholder: "<id>",
    },
    {
      name: "operator",
      describe: "Explicit local administrator intent",
      boolean: true,
    },
  ],
};
