import type { Command } from "../cli/command.js";
import { initSpec } from "./specs/inspection.js";
export const initCommand: Command = {
  ...initSpec,
  run: async (context) => (await import("./init/run.js")).run(context),
};
