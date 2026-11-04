import type { CommandSpec } from "../../cli/command.js";
import { configOption, jsonOption } from "../options/inspection.js";

export const statusSpec: CommandSpec = {
  name: "status",
  examples: ["pmcp status", "pmcp status --json | jq .data.projection"],
  describe: "Show enabled features, projection drift and live workspace state",
  usage: "pmcp status [--config <file>] [--json]",
  options: [configOption, jsonOption],
};
export const initSpec: CommandSpec = {
  name: "init",
  examples: ["pmcp init", "pmcp init --preset multi-session"],
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
  examples: [
    "pmcp hooks list --runtime claude",
    'pmcp hooks test --runtime codex --event before_tool --command "git add -A"',
  ],
  subcommands: [
    {
      name: "list",
      describe: "List compiled policies per runtime and event",
      usage:
        "pmcp hooks list [--runtime claude|codex] [--config <file>] [--json]",
      options: ["runtime", "config", "json"],
      examples: ["pmcp hooks list --runtime claude --json"],
    },
    {
      name: "test",
      describe: "Simulate one native hook call, or run a fixtures file",
      usage:
        "pmcp hooks test --runtime claude|codex --event <event> [--command <text> | --path <path> | --tool <name>] [--session-state <file>] [--json] | pmcp hooks test --fixtures <file> [--json]",
      options: [
        "runtime",
        "event",
        "command",
        "path",
        "tool",
        "session-state",
        "fixtures",
        "config",
        "json",
      ],
      examples: [
        'pmcp hooks test --runtime claude --event before_tool --command "git add -A"',
        "pmcp hooks test --fixtures hooks.fixtures.json",
      ],
    },
    {
      name: "report",
      describe: "Summarise the guard lines in the project log",
      usage:
        "pmcp hooks report [--since <when>] [--switch-check <guard>] [--json]",
      options: ["since", "switch-check", "config", "json"],
      examples: [
        "pmcp hooks report --since 2d",
        "pmcp hooks report --switch-check shell.heredoc",
      ],
    },
  ],
  defaultSubcommand: "list",
  describe:
    "List compiled policies or simulate a native hook without a runtime",
  usage: "pmcp hooks [<subcommand>] [options]",
  options: [
    configOption,
    jsonOption,
    {
      name: "fixtures",
      describe:
        "Run these cases through the projected hook entry for every wired runtime.",
      placeholder: "<file>",
    },
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
