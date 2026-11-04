import type { CommandSpec } from "../../cli/command.js";

export const completionSpec: CommandSpec = {
  name: "completion",
  examples: [
    "pmcp completion bash > ~/.local/share/bash-completion/completions/pmcp",
    'pmcp completion zsh > "${fpath[1]}/_pmcp"',
  ],
  describe: "Print a shell completion script for bash, zsh or fish",
  usage: "pmcp completion bash | zsh | fish",
};
