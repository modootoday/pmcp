import { gcWorktrees } from "../worktrees/gc.js";
import { off, type Action } from "./types.js";

export const worktreeGc: Action = (setup, context) => {
  const config = setup.config.worktrees ?? off("git.worktrees");
  const apply = context.args.flags.has("apply");
  const result = gcWorktrees(setup.ctx, config, { apply });
  if (context.args.flags.has("json")) {
    context.ui.data(JSON.stringify({ version: 1, ...result }) + "\n");
    return 0;
  }
  context.ui.results.records(
    result.items.map((item) => {
      const detail = item.reason ? ` (${item.reason})` : "";
      return `${item.action}\t${item.alias ?? "-"}\t${item.path}${detail}`;
    }),
  );
  return 0;
};
