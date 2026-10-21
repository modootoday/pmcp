import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
import { stampFile } from "../../src/git/install.js";
import { syncMainline } from "../../src/git/mainline/sync.js";
import type { MainlineSyncConfig, Reporter } from "../../src/git/types.js";
import {
  clone,
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

function settings(command: string): MainlineSyncConfig {
  return {
    install: ["sh", "-c", command],
    installWhenChanged: ["bun.lock"],
    keepIdenticalFiles: true,
    refuseWithUnlanded: true,
  };
}

function marking(marker: string): MainlineSyncConfig {
  return settings(`echo run >> ${marker}`);
}

function sync(
  origin: Remote,
  dir: string,
  config: MainlineSyncConfig,
  followSubmodules = true,
  report: Reporter = recorder(),
): number {
  return syncMainline({
    ctx: detect(dir)!,
    sync: config,
    followSubmodules,
    stateDir: join(origin.base, "state"),
    report,
  });
}

function runs(marker: string): number {
  if (!existsSync(marker)) return 0;
  return readFileSync(marker, "utf8").split("\n").filter(Boolean).length;
}

function push(
  origin: Remote,
  name: string,
  file: string,
  content: string,
): string {
  const other = clone(origin, name);
  const sha = commit(other, file, content, `change ${file}`);
  sh(other, "push", "-q", "origin", "HEAD:main");
  return sha;
}

it("refuses to move a main checkout that holds an unlanded commit", () => {
  const origin = remote();
  const own = commit(origin.main, "own.txt", "mine\n", "own work");
  push(origin, "other", "new.txt", "upstream\n");
  const report = recorder();
  const marker = join(origin.base, "installed");
  expect(sync(origin, origin.main, marking(marker), true, report)).toBe(1);
  expect(sh(origin.main, "rev-parse", "HEAD")).toBe(own);
  expect(report.lines.join("\n")).toMatch(/own work/u);
});

it("refuses to move a linked worktree", () => {
  const origin = remote();
  const desk = join(origin.base, "desk");
  sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk);
  expect(sync(origin, desk, marking(join(origin.base, "installed")))).toBe(2);
});

it("moves to the upstream, keeps identical untracked files and installs the new lockfile", () => {
  const origin = remote();
  const upstream = push(origin, "other", "bun.lock", "lock v2\n");
  writeFileSync(join(origin.main, "bun.lock"), "lock v2\n");
  const marker = join(origin.base, "installed");
  expect(sync(origin, origin.main, marking(marker))).toBe(0);
  expect(sh(origin.main, "rev-parse", "HEAD")).toBe(upstream);
  expect(runs(marker)).toBe(1);
});

it("does not install again once the stamp matches the lockfile", () => {
  const origin = remote();
  push(origin, "other", "bun.lock", "lock v2\n");
  const marker = join(origin.base, "installed");
  expect(sync(origin, origin.main, marking(marker))).toBe(0);
  push(origin, "other-2", "new.txt", "upstream\n");
  expect(sync(origin, origin.main, marking(marker))).toBe(0);
  expect(runs(marker)).toBe(1);
});

it("does not install in a checkout without the lockfile", () => {
  const origin = remote();
  push(origin, "other", "new.txt", "upstream\n");
  const marker = join(origin.base, "installed");
  expect(sync(origin, origin.main, marking(marker))).toBe(0);
  expect(runs(marker)).toBe(0);
});

it("keeps the stamp after a failed install and installs again on the next sync", () => {
  const origin = remote();
  push(origin, "other", "bun.lock", "lock v2\n");
  const marker = join(origin.base, "installed");
  const ok = join(origin.base, "install-ok");
  const flaky = settings(`echo run >> ${marker}; test -e ${ok}`);
  expect(sync(origin, origin.main, flaky)).toBe(1);
  const stamp = stampFile(origin.main, {
    command: flaky.install!,
    when: flaky.installWhenChanged,
    stateDir: join(origin.base, "state"),
  });
  expect(existsSync(stamp)).toBe(false);
  writeFileSync(ok, "");
  expect(sync(origin, origin.main, flaky)).toBe(0);
  expect(runs(marker)).toBe(2);
  expect(existsSync(stamp)).toBe(true);
});

function withSubmodule(): { origin: Remote; pin: () => string } {
  const origin = remote();
  const sub = remote();
  const seed = clone(origin, "seed-parent");
  sh(seed, "submodule", "add", "-q", sub.bare, "lib");
  sh(seed, "commit", "-q", "-m", "add lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  sh(origin.main, "submodule", "update", "--init", "-q");
  const pin = () => sh(join(origin.main, "lib"), "rev-parse", "HEAD");
  return { origin, pin };
}

function bumpSubmodule(origin: Remote): string {
  const other = clone(origin, "bump");
  const lib = join(other, "lib");
  sh(lib, "checkout", "-q", "-B", "main", "origin/main");
  const next = commit(lib, "lib.txt", "v2\n", "lib v2");
  sh(lib, "push", "-q", "origin", "HEAD:main");
  sh(other, "add", "lib");
  sh(other, "commit", "-q", "-m", "bump lib");
  sh(other, "push", "-q", "origin", "HEAD:main");
  return next;
}

it("follows a clean submodule to its new pin", () => {
  const { origin, pin } = withSubmodule();
  const next = bumpSubmodule(origin);
  const marker = join(origin.base, "installed");
  expect(sync(origin, origin.main, marking(marker))).toBe(0);
  expect(pin()).toBe(next);
});

it("leaves submodules on the old pin when following is off", () => {
  const { origin, pin } = withSubmodule();
  const before = pin();
  bumpSubmodule(origin);
  const marker = join(origin.base, "installed");
  expect(sync(origin, origin.main, marking(marker), false)).toBe(0);
  expect(pin()).toBe(before);
});
