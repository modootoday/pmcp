import type { CommandSpec } from "../../cli/command.js";

export const completionSpec: CommandSpec = {
  name: "completion",
  describe: "Print a shell completion script for bash, zsh or fish",
  usage: "pmcp completion bash | zsh | fish",
};
