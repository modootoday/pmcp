import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// A shared checkout (other sessions edit it too) left on an old pin broke a frozen install;
// it now moves when its edits do not conflict, and otherwise names the files, never
// restoring or discarding one.
function syncShared(origin: Remote, shared: string[], report: Reporter) {
  return syncMainline({
    ctx: detect(origin.main)!,
    sync: marking(join(origin.base, "installed")),
    followSubmodules: true,
    sharedSubmodules: shared,
    stateDir: join(origin.base, "state"),
    report,
  });
}

it("moves a shared submodule with an unrelated local edit, keeping the edit", () => {
  const { origin, pin } = withSubmodule();
  const next = bumpSubmodule(origin);
  const lib = join(origin.main, "lib");
  writeFileSync(join(lib, "README.md"), "local note\n");
  const report = recorder();
  expect(syncShared(origin, ["lib"], report)).toBe(0);
  expect(pin()).toBe(next);
  expect(readFileSync(join(lib, "README.md"), "utf8")).toBe("local note\n");
  expect(report.lines).toContain(
    `lib: moved to ${next.slice(0, 10)}, keeping its local edits`,
  );
});

it("leaves a shared submodule whose local file conflicts with the pin, and names it untouched", () => {
  const { origin, pin } = withSubmodule();
  const before = pin();
  const next = bumpSubmodule(origin);
  const lib = join(origin.main, "lib");
  writeFileSync(join(lib, "lib.txt"), "my draft\n");
  const report = recorder();
  expect(syncShared(origin, ["lib"], report)).toBe(0);
  expect(pin()).toBe(before);
  expect(readFileSync(join(lib, "lib.txt"), "utf8")).toBe("my draft\n");
  expect(report.lines).toContain(
    `lib: left at the old pin: local edits to lib.txt conflict with ${next.slice(0, 10)}; commit or move them, then sync again`,
  );
});

// A tracked directory turned into a gitlink upstream (a brand split out of the parent).
function directoryBecomesGitlink(nestedIgnore = false): {
  origin: Remote;
  pin: string;
} {
  const origin = remote();
  const sub = remote();
  const seed = clone(origin, "seed-dir");
  commit(seed, ".gitignore", "dist/\n", "ignore dist");
  mkdirSync(join(seed, "brand"));
  commit(seed, "brand/a.txt", "plain\n", "plain brand");
  if (nestedIgnore) {
    mkdirSync(join(seed, "brand", "app"));
    commit(seed, "brand/app/.gitignore", "test-results/\n", "nested ignore");
  }
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  sh(seed, "rm", "-rq", "brand");
  sh(seed, "submodule", "add", "-q", sub.bare, "brand");
  sh(seed, "commit", "-q", "-m", "brand becomes a gitlink");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  return { origin, pin: sh(join(seed, "brand"), "rev-parse", "HEAD") };
}

it("moves across a directory that became a gitlink and checks the new submodule out", () => {
  const { origin, pin } = directoryBecomesGitlink();
  const report = recorder();
  expect(syncShared(origin, [], report)).toBe(0);
  expect(sh(join(origin.main, "brand"), "rev-parse", "HEAD")).toBe(pin);
  expect(report.lines).toContain(
    `brand: new submodule checked out at ${pin.slice(0, 10)}`,
  );
});

it("moves the ignored output of a directory that became a gitlink aside, then checks it out", () => {
  const { origin, pin } = directoryBecomesGitlink();
  mkdirSync(join(origin.main, "brand", "dist"));
  writeFileSync(join(origin.main, "brand", "dist", "out.js"), "built\n");
  const report = recorder();
  expect(syncShared(origin, [], report)).toBe(0);
  const line = report.lines.find((l) => l.startsWith("brand: ")) ?? "";
  const aside =
    /are in (\S+), so run the install again$/u.exec(line)?.[1] ?? "";
  expect(line).toMatch(/^brand: new submodule checked out at /u);
  expect(sh(join(origin.main, "brand"), "rev-parse", "HEAD")).toBe(pin);
  expect(readFileSync(join(aside, "dist", "out.js"), "utf8")).toBe("built\n");
});

it("reads the ignore rules the departed directory held when it moves its output aside", () => {
  const { origin, pin } = directoryBecomesGitlink(true);
  mkdirSync(join(origin.main, "brand", "app", "test-results"));
  writeFileSync(
    join(origin.main, "brand", "app", "test-results", "last.json"),
    "{}\n",
  );
  const report = recorder();
  expect(syncShared(origin, [], report)).toBe(0);
  const line = report.lines.find((l) => l.startsWith("brand: ")) ?? "";
  const aside =
    /are in (\S+), so run the install again$/u.exec(line)?.[1] ?? "";
  expect(sh(join(origin.main, "brand"), "rev-parse", "HEAD")).toBe(pin);
  expect(
    readFileSync(join(aside, "app", "test-results", "last.json"), "utf8"),
  ).toBe("{}\n");
  expect(existsSync(join(aside, "app", ".gitignore"))).toBe(false);
});

it("names a file git does not ignore in a directory that became a gitlink, and keeps it", () => {
  const { origin } = directoryBecomesGitlink();
  writeFileSync(join(origin.main, "brand", "notes.txt"), "mine\n");
  const report = recorder();
  expect(syncShared(origin, [], report)).toBe(0);
  expect(readFileSync(join(origin.main, "brand", "notes.txt"), "utf8")).toBe(
    "mine\n",
  );
  expect(report.lines).toContain(
    "brand: new submodule not checked out: brand holds files git does not ignore; move them aside, then git submodule update --init brand",
  );
});

// A gitlink removed upstream leaves its checkout behind; the same repository returns later
// at a newer pin.
function gitlinkReturns(): { origin: Remote; pin: string } {
  const origin = remote();
  const sub = remote();
  const seed = clone(origin, "seed-return");
  sh(seed, "submodule", "add", "-q", sub.bare, "lib");
  sh(seed, "commit", "-q", "-m", "add lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  sh(origin.main, "submodule", "update", "--init", "-q");
  sh(seed, "rm", "-q", "lib");
  sh(seed, "commit", "-q", "-m", "drop lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  expect(syncShared(origin, [], recorder())).toBe(0);
  const work = clone(sub, "lib-work");
  const pin = commit(work, "lib.txt", "v2\n", "lib v2");
  sh(work, "push", "-q", "origin", "HEAD:main");
  const back = clone(origin, "readd");
  sh(back, "submodule", "add", "-q", sub.bare, "lib");
  sh(back, "commit", "-q", "-m", "lib returns");
  sh(back, "push", "-q", "origin", "HEAD:main");
  return { origin, pin };
}

it("moves the checkout an earlier gitlink left to the pin of the gitlink that returns", () => {
  const { origin, pin } = gitlinkReturns();
  const report = recorder();
  expect(syncShared(origin, [], report)).toBe(0);
  expect(sh(join(origin.main, "lib"), "rev-parse", "HEAD")).toBe(pin);
  expect(report.lines).toContain(
    `lib: earlier checkout moved to the new pin ${pin.slice(0, 10)}`,
  );
});

it("keeps an earlier checkout with a local edit where it is and names it", () => {
  const { origin, pin } = gitlinkReturns();
  writeFileSync(join(origin.main, "lib", "notes.txt"), "mine\n");
  const report = recorder();
  expect(syncShared(origin, [], report)).toBe(0);
  expect(sh(join(origin.main, "lib"), "rev-parse", "HEAD")).not.toBe(pin);
  expect(readFileSync(join(origin.main, "lib", "notes.txt"), "utf8")).toBe(
    "mine\n",
  );
  expect(report.lines).toContain(
    "lib: new submodule not checked out: the earlier checkout in lib holds changes or ignored files; move it aside, then git submodule update --init lib",
  );
});

it("still leaves a submodule that is not shared when it has edits", () => {
  const { origin, pin } = withSubmodule();
  const before = pin();
  bumpSubmodule(origin);
  writeFileSync(join(origin.main, "lib", "README.md"), "local note\n");
  const report = recorder();
  expect(syncShared(origin, [], report)).toBe(0);
  expect(pin()).toBe(before);
  expect(report.lines).toContain(
    "lib: left at the old pin: it has uncommitted changes",
  );
});
