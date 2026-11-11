import { dirToGitlinkPolicy } from "../dir-to-gitlink.js";
import { installSpec } from "../install.js";
import { syncWorktree } from "../worktrees/sync.js";
import { off, type Action } from "./types.js";
export const worktreeSync: Action = (setup, _context, report) => {
  const { config, ctx } = setup;
  if (config.worktrees === undefined) off("git.worktrees");
  const install =
    config.worktreeSync?.installAfterMove !== "off"
      ? installSpec(config.sync, setup.stateDir)
      : undefined;
  const result = syncWorktree({
    ctx,
    followSubmodules: config.submodules?.follow === "clean_pins",
    dirToGitlink: dirToGitlinkPolicy(config.submodules),
    report,
    ...(config.umask !== undefined ? { umask: config.umask } : {}),
    ...(install === undefined ? {} : { install }),
  });
  return result === "held" ? 1 : 0;
};
