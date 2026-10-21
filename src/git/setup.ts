import { join, resolve } from "node:path";

import { findConfig, readConfig } from "../config.js";
import { projectStateDir } from "../sessions/state-dir.js";
import { readGitConfig } from "./config.js";
import { detect } from "./detect.js";
import type { GitConfig, GitContext, LeaseSpec } from "./types.js";

export interface GitSetup {
  readonly config: GitConfig;
  readonly ctx: GitContext;
  readonly stateDir: string;
}

export function loadGit(
  cwd: string,
  configPath: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): GitSetup | Error {
  const path =
    configPath === undefined ? findConfig(cwd) : resolve(cwd, configPath);
  if (path === null)
    return new Error("no pmcp.toml found; the git workflow is opt-in");
  const config = readGitConfig(readConfig(path));
  if (config === null)
    return new Error(`[git] is absent or disabled in ${path}`);
  const ctx = detect(cwd, { remote: config.remote, mainline: config.mainline });
  if (ctx === null) return new Error(`${cwd} is not inside a git checkout`);
  // Use the hook's state-directory rule so delivery and hook policies observe the same pause and leases.
  const stateDir = projectStateDir(ctx.root, config.stateDir, env);
  return { config, ctx, stateDir };
}

export function gateTreePath(setup: GitSetup): string {
  return setup.config.gate?.tree ?? join(setup.stateDir, "gate", "tree");
}

export function leaseSpecs(config: GitConfig): readonly LeaseSpec[] {
  if (config.leases.length > 0) return config.leases;
  const paths = config.sync?.installWhenChanged ?? [];
  if (paths.length === 0) return [];
  return [{ name: "lockfile", paths }];
}
