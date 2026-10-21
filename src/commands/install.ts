import type { Command } from "../cli/command.js";
import { installSpec, syncSpec } from "./specs/remote.js";
import { manage } from "./install/run.js";

export const installCommand: Command = {
  ...installSpec,
  run: (context) => manage(context, false),
};
export const syncCommand: Command = {
  ...syncSpec,
  run: (context) => manage(context, true),
};
