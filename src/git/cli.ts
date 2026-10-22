import {
  ArgumentError,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { gitSpec } from "../commands/specs/git.js";
import type { Action } from "./cli/types.js";
import type { Reporter } from "./types.js";

// Load each git verb separately so worktree listing avoids delivery dependencies.
async function action(positional: readonly string[]): Promise<Action> {
  const [verb, sub] = positional;
  if (verb === "deliver")
    return (await import("./cli/mainline.js")).mainlineDeliver;
  if (verb === "sync") return (await import("./cli/mainline.js")).mainlineSync;
  if (verb !== "worktree")
    throw new ArgumentError("Use worktree, deliver or sync");
  if (sub === "create")
    return (await import("./cli/worktree-create.js")).worktreeCreate;
  if (sub === "list")
    return (await import("./cli/worktree-list.js")).worktreeList;
  if (sub === "sync")
    return (await import("./cli/worktree-sync.js")).worktreeSync;
  throw new ArgumentError("Use worktree create, list or sync");
}

async function run(context: CommandContext): Promise<number> {
  const [verb, sub] = context.args.positional;
  if (
    context.args.flags.has("json") &&
    !(verb === "worktree" && sub === "list") &&
    verb !== "deliver"
  )
    throw new ArgumentError("--json requires git worktree list or git deliver");
  const act = await action(context.args.positional);
  const { loadGit } = await import("./setup.js");
  const setup = loadGit(context.cwd, one(context.args, "config"), context.env);
  if (setup instanceof Error) {
    context.ui.error(setup.message);
    return 2;
  }
  const report: Reporter = {
    info: (line) => context.ui.info(line),
    warn: (line) => context.ui.warn(line),
  };
  // Every checkout these commands write, a new worktree included, takes [git] umask.
  const { withUmask } = await import("./modes.js");
  return withUmask(setup.config.umask, () => act(setup, context, report));
}

export const gitCommand: Command = { ...gitSpec, run };
