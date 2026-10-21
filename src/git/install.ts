import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { gitText, runCommand } from "./exec.js";
import type { Argv, MainlineSyncConfig, Reporter } from "./types.js";

// A stamp another tool also reads ([git.mainline.sync] stamp): its path, where ${git_dir} is
// the checkout's own git directory, and its hash: "plain" is the sha256 of the one lock
// file's bytes, "pmcp" pmcp's own over every install_when_changed path.
export interface StampSpec {
  readonly path: string;
  readonly hash: "pmcp" | "plain";
}

export interface InstallSpec {
  readonly command: Argv;

  readonly when: readonly string[];

  readonly stateDir: string;
  readonly stamp?: StampSpec;
}

export function installSpec(
  sync: MainlineSyncConfig | undefined,
  stateDir: string,
): InstallSpec | undefined {
  if (sync?.install === undefined || sync.installWhenChanged.length === 0)
    return undefined;
  return {
    command: sync.install,
    when: sync.installWhenChanged,
    stateDir,
    ...(sync.stamp ? { stamp: sync.stamp } : {}),
  };
}

export function lockHash(
  root: string,
  paths: readonly string[],
): string | null {
  const hash = createHash("sha256");
  let found = false;
  for (const path of paths) {
    const file = join(root, path);
    if (!existsSync(file)) continue;
    found = true;
    hash.update(`${path}\0`).update(readFileSync(file));
  }
  if (!found) return null;
  return hash.digest("hex");
}

// The hash a stamp records for this checkout's lock files.
export function installedHash(root: string, spec: InstallSpec): string | null {
  if (spec.stamp?.hash !== "plain") return lockHash(root, spec.when);
  const file = join(root, spec.when[0] ?? "");
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// Keep stamps per checkout because worktrees have independent installed packages.
export function stampFile(root: string, spec: InstallSpec): string {
  if (spec.stamp) {
    const gitDir = gitText(root, ["rev-parse", "--absolute-git-dir"]);
    return spec.stamp.path.replace("${git_dir}", gitDir);
  }
  const key = createHash("sha256")
    .update([root, ...spec.when].join("\0"))
    .digest("hex");
  return join(spec.stateDir, "installed", key);
}

export function readStamp(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

// The current lock hash and whether this checkout's install is for exactly it.
export function installState(
  root: string,
  spec: InstallSpec,
): { readonly hash: string | null; readonly installed: boolean } {
  const hash = installedHash(root, spec);
  return {
    hash,
    installed: hash !== null && readStamp(stampFile(root, spec)) === hash,
  };
}

// Write stamps only after success so failed installs remain eligible for retry.
export function installIfStale(
  root: string,
  spec: InstallSpec,
  report: Reporter,
): number | null {
  const hash = installedHash(root, spec);
  const stamp = stampFile(root, spec);
  if (hash === null || readStamp(stamp) === hash) return null;
  report.info(
    `${spec.when.join(", ")} not installed here: ${spec.command.join(" ")}`,
  );
  const status = runCommand(spec.command, root);
  if (status !== 0) {
    report.warn(`the install exited ${status}; the next sync runs it again`);
    return status;
  }
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, `${hash}\n`);
  return 0;
}
