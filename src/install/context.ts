import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { workspaceContains } from "./workspace.js";

export interface ProjectManifest {
  readonly packageManager?: string;
  readonly workspaces?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const locks = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
];
export type PackageManager = "npm" | "bun" | "pnpm";
export interface InstallContext {
  readonly project: string;
  readonly root: string;
  readonly manager: PackageManager;
  readonly manifest: ProjectManifest;
  readonly files: readonly string[];
  readonly fingerprint: string;
}

export function fingerprint(files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file).update("\0");
    try {
      hash.update(readFileSync(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("absent");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function manifestAt(directory: string): ProjectManifest {
  const value: unknown = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid project manifest");
  return value as ProjectManifest;
}

function managerForLock(file: string): PackageManager | "unsupported" {
  if (file.startsWith("bun.")) return "bun";
  if (file === "pnpm-lock.yaml") return "pnpm";
  if (file === "package-lock.json" || file === "npm-shrinkwrap.json")
    return "npm";
  return "unsupported";
}

function workspaceRoot(project: string): string {
  let ancestor = project;
  for (;;) {
    if (ancestor !== project && existsSync(join(ancestor, "package.json"))) {
      const candidate = manifestAt(ancestor);
      if (
        candidate.workspaces !== undefined ||
        existsSync(join(ancestor, "pnpm-workspace.yaml"))
      ) {
        if (!workspaceContains(ancestor, project))
          throw new Error("project is excluded from the ancestor workspace");
        return ancestor;
      }
      if (locks.some((file) => existsSync(join(ancestor, file))))
        return project;
    }
    if (existsSync(join(ancestor, ".git")) || dirname(ancestor) === ancestor)
      return project;
    ancestor = dirname(ancestor);
  }
}

export function installContext(directory: string): InstallContext {
  const project = realpathSync(directory);
  const manifest = manifestAt(project);
  const root = workspaceRoot(project);
  const owner = manifestAt(root);
  const lockNames = locks.filter((file) => existsSync(join(root, file)));
  const lockManagers = new Set(lockNames.map(managerForLock));
  if (lockManagers.size > 1 || lockManagers.has("unsupported"))
    throw new Error("conflicting or unsupported package manager lockfiles");
  const declared = owner.packageManager?.match(
    /^(npm|bun|pnpm)@\d+\.\d+\.\d+(?:[-+].+)?$/u,
  )?.[1];
  if (owner.packageManager !== undefined && !declared)
    throw new Error("only npm, Bun and pnpm projects are supported");
  const locked = [...lockManagers][0];
  if (declared && locked && declared !== locked)
    throw new Error("packageManager and lockfile disagree");
  const manager = declared ?? locked;
  if (manager !== "npm" && manager !== "bun" && manager !== "pnpm")
    throw new Error(
      "declare packageManager or install project dependencies first",
    );
  if (root !== project && locks.some((file) => existsSync(join(project, file))))
    throw new Error(
      "nested project has its own lockfile; resolve the workspace boundary first",
    );
  const files = [
    ...new Set([
      join(root, "package.json"),
      join(project, "package.json"),
      join(root, "pnpm-workspace.yaml"),
      join(root, ".npmrc"),
      join(project, ".npmrc"),
      ...locks.map((file) => join(root, file)),
    ]),
  ];
  return {
    project,
    root,
    manager,
    manifest,
    files,
    fingerprint: fingerprint(files),
  };
}
