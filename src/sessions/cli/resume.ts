import type { CommandContext } from "../../cli/command.js";
import { change } from "./verbs.js";
export const run = (context: CommandContext): number =>
  change(context, "resume");
