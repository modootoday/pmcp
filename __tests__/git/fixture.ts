import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanEnv } from "../../src/git/exec.js";
import type { Reporter } from "../../src/git/types.js";

export function isolateGit(): void {
  const empty = join(
    mkdtempSync(join(tmpdir(), "pmcp-git-home-")),
    "gitconfig",
  );
  writeFileSync(empty, "");
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
    GIT_CONFIG_KEY_1: "init.defaultBranch",
    GIT_CONFIG_VALUE_1: "main",
  });
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: cleanEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function commit(
  cwd: string,
  file: string,
  content: string,
  message: string,
): string {
  writeFileSync(join(cwd, file), content);
  sh(cwd, "add", file);
  sh(cwd, "commit", "-q", "-m", message);
  return sh(cwd, "rev-parse", "HEAD");
}

export interface Remote {
  readonly base: string;
  readonly bare: string;
  readonly main: string;
}

export function remote(): Remote {
  const base = mkdtempSync(join(tmpdir(), "pmcp-git-"));
  const bare = join(base, "origin.git");
  sh(base, "init", "-q", "--bare", bare);
  const seed = join(base, "seed");
  sh(base, "clone", "-q", bare, seed);
  commit(seed, "README.md", "seed\n", "seed");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  rmSync(seed, { recursive: true, force: true });
  return { base, bare, main: clone({ base, bare, main: "" }, "main") };
}

export function clone(origin: Remote, name: string): string {
  const dir = join(origin.base, name);
  sh(origin.base, "clone", "-q", "--recurse-submodules", origin.bare, dir);
  return dir;
}

export function recorder(): Reporter & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (line) => lines.push(line),
    warn: (line) => lines.push(line),
  };
}
