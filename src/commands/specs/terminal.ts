import type { CommandSpec, SubcommandSpec } from "../../cli/command.js";
import { harnessOptions } from "../harness/options.js";
import { tuiOptions } from "../tui/options.js";
import { HARNESS_OPERATIONS } from "./harness-operations.js";

const HOST: readonly SubcommandSpec[] = [
  ["approve", "Record your approval of the projected [host] policy"],
  ["status", "Whether the projected policy is approved"],
  ["up", "Start pmcp-pty and the approved sessions (Linux)"],
  ["down", "Stop the host's sessions"],
  ["unit", "Print a systemd user unit for pmcp-pty (Linux)"],
].map(([verb, describe]) => ({
  name: `host ${verb}`,
  describe: describe!,
  usage: `pmcp harness host ${verb}`,
  options: [],
  examples: [`pmcp harness host ${verb}`],
}));

const FAMILY: readonly SubcommandSpec[] = Object.entries(
  HARNESS_OPERATIONS,
).map(([key, operation]) => {
  const name = key.replace(":", " ");
  const flags = operation.options.map((option) => `--${option} <value>`);
  return {
    name,
    describe: operation.describe,
    usage: [`pmcp harness ${name}`, ...flags].join(" "),
    options: operation.options,
    examples: [[`pmcp harness ${name}`, ...flags].join(" ")],
  };
});

export const harnessSpec: CommandSpec = {
  name: "harness",
  protocol: true,
  describe:
    "Manage optional owned native sessions independently of the MCP server",
  usage: "pmcp harness <subcommand> [options]",
  options: harnessOptions,
  subcommands: [
    {
      name: "layout",
      describe: "Plan the terminal layout for a size",
      usage: "pmcp harness layout [--columns <count>] [--rows <count>]",
      options: ["columns", "rows"],
      examples: ["pmcp harness layout --columns 120 --rows 40"],
    },
    ...HOST,
    {
      name: "mcp",
      describe: "A stdio MCP server for one pmcp-pty socket (PMCP_PTY_SOCKET)",
      usage: "pmcp harness mcp",
      options: [],
      examples: [
        "PMCP_PTY_SOCKET=/run/user/1000/pmcp-pty.sock pmcp harness mcp",
      ],
    },
    ...FAMILY,
  ],
  examples: [
    "pmcp harness doctor inspect",
    'pmcp harness group inspect --group-file "$GROUP_FILE"',
    "pmcp harness host status",
  ],
};

export const tuiSpec: CommandSpec = {
  name: "tui",
  describe: "Open a native terminal workspace with optional configuration",
  usage:
    "pmcp tui [--config <file>] [--runtime <id>] [-y] [--new] | pmcp tui <subcommand> [options]",
  options: tuiOptions,
  subcommands: [
    {
      name: "plan",
      describe: "What a launch would do, without starting it",
      usage: "pmcp tui plan [--config <file>] [--runtime <id>] [--json]",
      options: ["config", "runtime", "json"],
      examples: ["pmcp tui plan --runtime codex-cli"],
    },
    {
      name: "recovery",
      describe: "What to run when a workspace was left behind",
      usage: "pmcp tui recovery [--config <file>] [--json]",
      options: ["config", "json"],
      examples: ["pmcp tui recovery"],
    },
    {
      name: "doctor",
      describe: "Terminal host prerequisites",
      usage: "pmcp tui doctor [--json]",
      options: ["json"],
      examples: ["pmcp tui doctor --json"],
    },
    {
      name: "start-worker",
      describe: "Start a worker in the dock",
      usage:
        "pmcp tui start-worker --runtime <id> [--memory-mb <count>] [--config <file>] [--json]",
      options: ["config", "runtime", "memory-mb", "json"],
      examples: ["pmcp tui start-worker --runtime claude-code"],
    },
  ],
  examples: ["pmcp tui", "pmcp tui --runtime codex-cli", "pmcp tui plan"],
};
