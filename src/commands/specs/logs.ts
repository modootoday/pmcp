import type { CommandSpec } from "../../cli/command.js";
import { jsonOption, nearestConfigOption } from "../options/inspection.js";

export const logsSpec: CommandSpec = {
  name: "logs",
  describe:
    "Read this project's pmcp JSONL logs, filtered by session, trace, component, level or time",
  usage:
    "pmcp logs [--session <id>] [--trace <id>] [--component <name>] [--level <level>] [--since <10m|ISO>] [--follow] [--pretty]",
  options: [
    jsonOption,
    nearestConfigOption,
    {
      name: "session",
      describe: "Only this session (a prefix is enough).",
      placeholder: "<id>",
    },
    { name: "trace", describe: "Only this hook call.", placeholder: "<id>" },
    {
      name: "component",
      describe: "Only this component and those below it.",
      placeholder: "<name>",
    },
    {
      name: "level",
      describe: "This level and more severe.",
      placeholder: "<level>",
    },
    {
      name: "since",
      describe: "From this long ago (10m, 2h, 3d) or this ISO time.",
      placeholder: "<when>",
    },
    {
      name: "follow",
      describe: "Keep printing new lines until interrupted.",
      boolean: true,
    },
    {
      name: "pretty",
      describe: "One readable line per record instead of JSON.",
      boolean: true,
    },
  ],
};
