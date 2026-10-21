import type { CommandSpec } from "../../cli/command.js";
import { configOption } from "../options/inspection.js";

export const mailboxSpec: CommandSpec = {
  name: "mailbox",
  describe: "Manage opt-in local peer mail and launcher credentials",
  usage: "pmcp mailbox operation [--config <file>] [options]",
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
