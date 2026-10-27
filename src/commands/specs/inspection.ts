import type { CommandSpec } from "../../cli/command.js";
import { configOption, jsonOption } from "../options/inspection.js";

export const statusSpec: CommandSpec = {
  name: "status",
  describe: "Show enabled features, projection drift and live workspace state",
  usage: "pmcp status [--config <file>] [--json]",
  options: [configOption, jsonOption],
};
export const initSpec: CommandSpec = {
  name: "init",
  describe: "Create a starting pmcp.toml using this checkout's git detection",
  usage: "pmcp init [--preset solo|multi-session] [--force]",
  options: [
    {
      name: "preset",
      describe: "Starting configuration; default solo.",
      placeholder: "<preset>",
    },
    {
      name: "force",
      describe: "Replace an existing pmcp.toml.",
      boolean: true,
    },
  ],
};
export const hooksSpec: CommandSpec = {
  name: "hooks",
  describe:
    "List compiled policies, simulate a native hook without a runtime, or summarise guard logs",
  usage:
    "pmcp hooks list | test --runtime claude|codex --event <event> [--command <text> | --path <path> | --tool <name>] [--session-state <file>] [--json] | report [--since <when>] [--switch-check <guard>] [--json]",
  options: [
    configOption,
    jsonOption,
    {
      name: "since",
      describe:
        "Report only log lines from this long ago (10m, 2h, 3d) or this ISO time.",
      placeholder: "<when>",
    },
    {
      name: "switch-check",
      describe: "List the calls this guard found something in but let through.",
      placeholder: "<guard>",
    },
    {
      name: "runtime",
      describe: "Native runtime to inspect.",
      placeholder: "<runtime>",
    },
    {
      name: "event",
      describe: "Neutral or native event name.",
      placeholder: "<event>",
    },
    {
      name: "command",
      describe: "Shell command to classify; never executed.",
      placeholder: "<text>",
    },
    {
      name: "path",
      describe: "Path for a synthetic edit.",
      placeholder: "<path>",
    },
    {
      name: "tool",
      describe: "Native tool name or shell, edit, read, other.",
      placeholder: "<name>",
    },
    {
      name: "session-state",
      describe: "JSON seed for isolated session state.",
      placeholder: "<file>",
    },
  ],
};
