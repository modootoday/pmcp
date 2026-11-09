import { worktreeRows } from "../worktrees/list.js";
import { off, type Action } from "./types.js";
export const worktreeList: Action = (setup, context) => {
  const config = setup.config.worktrees ?? off("git.worktrees");
  const rows = worktreeRows(setup.ctx, config);
  if (context.args.flags.has("json")) {
    context.ui.data(JSON.stringify({ version: 1, worktrees: rows }) + "\n");
    return 0;
  }
  context.ui.results.records(
    rows.map((row) => {
      const name = row.main ? "(main)" : (row.alias ?? "-");
      const counts =
        row.behind === undefined ? "-" : `-${row.behind}/+${row.ahead}`;
      return `${name}\t${row.branch ?? "(detached)"}\t${counts}\t${row.path}`;
    }),
  );
  return 0;
};
