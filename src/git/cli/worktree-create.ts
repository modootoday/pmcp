import { ArgumentError, one } from "../../cli/command.js";
import { createWorktree } from "../worktrees/create.js";
import { off, type Action } from "./types.js";
export const worktreeCreate: Action = (setup, context, report) => {
  const alias = context.args.positional[2];
  if (alias === undefined)
    throw new ArgumentError("Provide the worktree alias");
  const config = setup.config.worktrees ?? off("git.worktrees");
  const base = one(context.args, "base");
  const created = createWorktree({
    ctx: setup.ctx,
    config,
    alias,
    report,
    ...(base === undefined ? {} : { base }),
  });
  context.ui.data(`${created.path}\n`);
  return 0;
};
