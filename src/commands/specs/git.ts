import type { CommandSpec } from "../../cli/command.js";
import { configOption, jsonOption } from "../options/inspection.js";

export const gitSpec: CommandSpec = {
  name: "git",
  describe:
    "Create and sync worktrees, deliver commits to the mainline, sync the main checkout",
  usage:
    "pmcp git worktree create <alias> | worktree list | worktree sync | deliver [<commit>...] | sync",
  options: [
    jsonOption,
    configOption,
    {
      name: "base",
      describe: "Start a new worktree from this ref instead of the upstream",
      placeholder: "<ref>",
    },
    {
      name: "during-pause",
      describe: "Deliver although the sessions are paused",
      boolean: true,
    },
    {
      name: "no-push",
      describe: "Replay and gate, then stop without pushing",
      boolean: true,
    },
  ],
};
