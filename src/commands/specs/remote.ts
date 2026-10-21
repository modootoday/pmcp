import type { CommandSpec } from "../../cli/command.js";
import { REMOTE_OPTIONS } from "../options/remote.js";

export const availableSpec: CommandSpec = {
  name: "available",
  describe:
    "Find provided skills matching this project's installed dependencies",
  usage: "pmcp available [--project <dir>] [--catalog <file>] [--json]",
  options: REMOTE_OPTIONS,
};

export const previewSpec: CommandSpec = {
  name: "preview",
  describe: "Show a skill's contents and a complete example",
  usage: "pmcp preview <skill-package> [--json]",
  options: REMOTE_OPTIONS,
};

const MANAGE_OPTIONS = [
  ...REMOTE_OPTIONS,
  {
    name: "dry-run",
    describe: "Show the plan without installing or changing files.",
    boolean: true,
  },
  {
    name: "yes",
    describe: "Approve the displayed project and lockfile changes.",
    boolean: true,
  },
];

export const installSpec: CommandSpec = {
  name: "install",
  describe:
    "Install matching skill npm packages with the project's package manager",
  usage: "pmcp install <skill-package>... | --all [--dry-run | --yes]",
  options: [
    ...MANAGE_OPTIONS,
    {
      name: "all",
      describe: "Select all matching skill packages.",
      boolean: true,
    },
  ],
};

export const syncSpec: CommandSpec = {
  name: "sync",
  describe:
    "Update declared skill packages without removing other dependencies",
  usage: "pmcp sync [--project <dir>] [--dry-run | --yes]",
  options: MANAGE_OPTIONS,
};
