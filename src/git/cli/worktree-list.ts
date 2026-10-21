import { worktreeRows } from "../worktrees/list.js";
import { off, type Action } from "./types.js";
export const worktreeList: Action = (setup, context) => {
  const config = setup.config.worktrees ?? off("git.worktrees");
  const rows = worktreeRows(setup.ctx, config);
  if (context.args.flags.has("json")) {
    context.ui.data(JSON.stringify({ version: 1, worktrees: rows }) + "\n");
    return 0;
  }
  for (const row of rows) {
    const name = row.main ? "(main)" : (row.alias ?? "-");
    const counts =
      row.behind === undefined ? "-" : `-${row.behind}/+${row.ahead}`;
    context.ui.data(
      `${name}\t${row.branch ?? "(detached)"}\t${counts}\t${row.path}\n`,
    );
  }
  return 0;
};
