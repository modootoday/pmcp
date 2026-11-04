import type { CommandSpec } from "../../cli/command.js";
import { configOption, jsonOption } from "../options/inspection.js";

export const gitSpec: CommandSpec = {
  name: "git",
  examples: ["pmcp git worktree create review", "pmcp git deliver --json"],
  subcommands: [
    {
      name: "worktree create",
      describe: "Make a linked worktree on a new branch from the upstream",
      usage: "pmcp git worktree create <alias> [--base <ref>]",
      options: ["base", "config"],
      examples: ["pmcp git worktree create review --base origin/main"],
    },
    {
      name: "worktree list",
      describe: "The main checkout and each linked worktree, with behind/ahead",
      usage: "pmcp git worktree list [--json]",
      options: ["config", "json"],
      examples: ["pmcp git worktree list --json"],
    },
    {
      name: "worktree sync",
      describe: "Move this worktree onto the mainline when that loses nothing",
      usage: "pmcp git worktree sync",
      options: ["config"],
      examples: ["pmcp git worktree sync"],
    },
    {
      name: "deliver",
      describe: "Replay, gate and push commits to the mainline",
      usage:
        "pmcp git deliver [<commit>...] [--during-pause] [--no-push] [--json]",
      options: ["during-pause", "no-push", "config", "json"],
      examples: ["pmcp git deliver", "pmcp git deliver 1a2b3c4 --no-push"],
    },
    {
      name: "sync",
      describe: "Move the main checkout, or this desk, to the mainline",
      usage: "pmcp git sync",
      options: ["config"],
      examples: ["pmcp git sync"],
    },
    {
      name: "affected",
      describe: "The workspace members a delta touches, with their consumers",
      usage:
        "pmcp git affected --base <ref> [--head <ref>] [--tests-only] [--json]",
      options: ["base", "head", "tests-only", "config", "json"],
      examples: [
        "pmcp git affected --base origin/main",
        "pmcp git affected --base HEAD~3 --tests-only --json",
      ],
    },
  ],
  describe:
    "Create and sync worktrees, deliver commits to the mainline, sync the main checkout",
  usage: "pmcp git <subcommand> [options]",
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
