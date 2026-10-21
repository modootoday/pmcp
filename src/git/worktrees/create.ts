import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { git, gitOk, runCommand } from "../exec.js";
import type { GitContext, Reporter, WorktreesConfig } from "../types.js";

export interface CreateOptions {
  readonly ctx: GitContext;
  readonly config: WorktreesConfig;
  readonly alias: string;
  readonly base?: string;
  readonly report: Reporter;
}

export interface Created {
  readonly path: string;
  readonly branch: string;
}

// Link untracked host files so desks retain required local configuration without copying credentials.
function linkFromMain(
  ctx: GitContext,
  path: string,
  names: readonly string[],
): string[] {
  const linked: string[] = [];
  for (const name of names) {
    const source = join(ctx.mainRoot, name);
    const target = join(path, name);
    if (!existsSync(source) || existsSync(target)) continue;
    symlinkSync(source, target);
    linked.push(name);
  }
  return linked;
}

export function createWorktree(options: CreateOptions): Created {
  const { ctx, config, alias, report } = options;
  if (!new RegExp(config.aliasPattern, "u").test(alias))
    throw new Error(`alias ${alias} does not match ${config.aliasPattern}`);
  const path = join(ctx.mainRoot, config.root, alias);
  const branch = `${config.branchPrefix}${alias}`;
  if (existsSync(path)) throw new Error(`${path} already exists`);
  if (
    gitOk(ctx.mainRoot, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])
  )
    throw new Error(`branch ${branch} already exists`);
  if (options.base === undefined)
    git(ctx.mainRoot, ["fetch", "-q", ctx.remote, ctx.mainline]);
  const base = options.base ?? ctx.upstream;
  const added = git(ctx.mainRoot, [
    "worktree",
    "add",
    "-q",
    "--no-track",
    "-b",
    branch,
    path,
    base,
  ]);
  if (added.status !== 0)
    throw new Error(`worktree add failed: ${added.stderr.trim()}`);
  const linked = linkFromMain(ctx, path, config.linkFromMain);
  if (linked.length > 0)
    report.info(`linked from the main checkout: ${linked.join(", ")}`);
  if (config.bootstrap !== undefined) {
    const status = runCommand(config.bootstrap, path, {
      PMCP_WORKTREE_ALIAS: alias,
    });
    if (status !== 0)
      throw new Error(
        `bootstrap exited ${status}; the worktree stays at ${path}`,
      );
  }
  report.info(`created ${path} on ${branch} from ${base}`);
  return { path, branch };
}
