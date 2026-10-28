import { dirname, join, resolve } from "node:path";

import { findConfig, readConfig } from "../config.js";
import { projectStateDir } from "../sessions/state-dir.js";
import {
  resolveLeaseFiles,
  resolvePauseFile,
  type LeaseFiles,
} from "../sessions/lease-files.js";
import { readStoreSettings } from "../sessions/settings.js";
import { readGitConfig } from "./config.js";
import { detect } from "./detect.js";
import type { GitConfig, GitContext, LeaseSpec } from "./types.js";

export interface GitSetup {
  readonly config: GitConfig;
  readonly ctx: GitContext;
  readonly stateDir: string;
  // Resolved for this run: tree_env wins over tree, and lease files follow the gate dir.
  readonly gateTree: string;
  readonly leaseFiles: Readonly<Record<string, LeaseFiles>>;
  // [sessions] pause_file, resolved like the lease files; absent means the state dir's.
  readonly pauseFile?: string;
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
  const project = readConfig(path);
  const config = readGitConfig(project);
  if (config === null)
    return new Error(`[git] is absent or disabled in ${path}`);
  const ctx = detect(cwd, { remote: config.remote, mainline: config.mainline });
  if (ctx === null) return new Error(`${cwd} is not inside a git checkout`);
  // Use the hook's state-directory rule so delivery and hook policies observe the same pause and leases.
  const stateDir = projectStateDir(ctx.root, config.stateDir, env);
  const override = config.gate?.treeEnv ? env[config.gate.treeEnv] : undefined;
  const tree =
    override || (config.gate?.tree ?? join(stateDir, "gate", "tree"));
  const settings = readStoreSettings(
    project.raw["sessions"],
    project.raw["git"],
  );
  const leaseFiles = resolveLeaseFiles(settings.leaseFiles, dirname(tree));
  const pauseFile = resolvePauseFile(settings.pauseFile, dirname(tree));
  return {
    config,
    ctx,
    stateDir,
    gateTree: tree,
    leaseFiles,
    ...(pauseFile ? { pauseFile } : {}),
  };
}

export function gateTreePath(setup: GitSetup): string {
  return setup.gateTree;
}

export function leaseSpecs(config: GitConfig): readonly LeaseSpec[] {
  if (config.leases.length > 0) return config.leases;
  const paths = config.sync?.installWhenChanged ?? [];
  if (paths.length === 0) return [];
  return [{ name: "lockfile", paths }];
}
