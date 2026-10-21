import { syncWorktree } from "../worktrees/sync.js";
import { off, type Action } from "./types.js";
export const worktreeSync: Action = (setup, _context, report) => {
  const { config, ctx } = setup;
  if (config.worktrees === undefined) off("git.worktrees");
  const command = config.sync?.install;
  const installs =
    command !== undefined && config.worktreeSync?.installAfterMove !== "off";
  const when = config.sync?.installWhenChanged ?? [];
  const install = installs
    ? { command, when, stateDir: setup.stateDir }
    : undefined;
  const result = syncWorktree({
    ctx,
    followSubmodules: config.submodules?.follow === "clean_pins",
    report,
    ...(install === undefined ? {} : { install }),
  });
  return result === "held" ? 1 : 0;
};
