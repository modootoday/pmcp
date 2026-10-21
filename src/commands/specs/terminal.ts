import type { CommandSpec } from "../../cli/command.js";
import { harnessOptions } from "../harness/options.js";
import { tuiOptions } from "../tui/options.js";

export const harnessSpec: CommandSpec = {
  name: "harness",
  describe:
    "Manage optional owned native sessions independently of the MCP server",
  usage: "pmcp harness layout | family operation [options]",
  options: harnessOptions,
};

export const tuiSpec: CommandSpec = {
  name: "tui",
  describe: "Open a native terminal workspace with optional configuration",
  usage:
    "pmcp tui [--config <file>] [--runtime <id>] | plan | recovery | doctor | start-worker --runtime <id>",
  options: tuiOptions,
};
