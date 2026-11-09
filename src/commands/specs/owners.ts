import type { CommandSpec } from "../../cli/command.js";
import { jsonOption, nearestConfigOption } from "../options/inspection.js";

export const ownersSpec: CommandSpec = {
  name: "owners",
  examples: [
    "pmcp owners services/auth/src/login.ts",
    "pmcp owners docs --json",
  ],
  describe: "Who looks after a path, from [[owners]] in pmcp.toml",
  usage: "pmcp owners <path>... [--config <file>] [--json]",
  options: [nearestConfigOption, jsonOption],
};
