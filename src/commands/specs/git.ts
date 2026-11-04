import type { CommandSpec } from "../../cli/command.js";
import { configOption, jsonOption } from "../options/inspection.js";

export const gitSpec: CommandSpec = {
  name: "git",
  subcommands: [
    {
      name: "worktree create",
      describe: "Make a linked worktree on a new branch",
    },
    {
      name: "worktree list",
      describe: "The main checkout and each linked worktree",
    },
    {
      name: "worktree sync",
      describe: "Move this worktree onto the mainline",
    },
    {
      name: "deliver",
      describe: "Replay, gate and push commits to the mainline",
    },
    {
      name: "sync",
      describe: "Move the main checkout or a desk to the mainline",
    },
  ],
  describe:
    "Create and sync worktrees, deliver commits to the mainline, sync the main checkout",
  usage:
    "pmcp git worktree create <alias> | worktree list | worktree sync | deliver [<commit>...] | sync | affected --base <ref>",
  options: [
    jsonOption,
    configOption,
    {
      name: "base",
      describe:
        "Start a new worktree from this ref instead of the upstream; for affected, the ref the delta starts at",
      placeholder: "<ref>",
    },
    {
      name: "head",
      describe: "For affected, the ref the delta ends at (default HEAD)",
      placeholder: "<ref>",
    },
    {
      name: "tests-only",
      describe: "For affected, print changed members without their consumers",
      boolean: true,
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
