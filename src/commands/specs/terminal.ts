import type { CommandSpec } from "../../cli/command.js";
import { harnessOptions } from "../harness/options.js";
import { tuiOptions } from "../tui/options.js";

export const harnessSpec: CommandSpec = {
  name: "harness",
  protocol: true,
  describe:
    "Manage optional owned native sessions independently of the MCP server",
  usage: "pmcp harness layout | family operation [options]",
  options: harnessOptions,
};

export const tuiSpec: CommandSpec = {
  name: "tui",
  subcommands: [
    { name: "plan", describe: "What a launch would do, without starting it" },
    {
      name: "recovery",
      describe: "What to run when a workspace was left behind",
    },
    { name: "doctor", describe: "Terminal host prerequisites" },
    { name: "start-worker", describe: "Start a worker in the dock" },
  ],
  describe: "Open a native terminal workspace with optional configuration",
  usage:
    "pmcp tui [--config <file>] [--runtime <id>] | plan | recovery | doctor | start-worker --runtime <id>",
  options: tuiOptions,
};
