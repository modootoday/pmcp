import type { Command } from "../cli/command.js";
import { statusSpec } from "./specs/inspection.js";
import { run } from "../status/run.js";
export const statusCommand: Command = {
  ...statusSpec,
  run,
};
