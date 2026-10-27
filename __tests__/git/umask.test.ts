import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { readGitConfig } from "../../src/git/config.js";
import { detect } from "../../src/git/detect.js";
import { deliver } from "../../src/git/mainline/deliver.js";
import { syncMainline } from "../../src/git/mainline/sync.js";
import type { MainlineSyncConfig, Reporter } from "../../src/git/types.js";
import { syncWorktree } from "../../src/git/worktrees/sync.js";
import type { ProjectConfig } from "../../src/config.js";
import {
  clone,
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

// Live: a sync run under umask 0077 rewrote a tracked, bind-mounted config file as 0600, and a
// container reading it as another user crash-looped. Every move here runs at umask 0077.
let saved = 0;
beforeAll(() => {
  isolateGit();
  saved = process.umask();
});
afterAll(() => {
  process.umask(saved);
});

const mode = (file: string) => statSync(file).mode & 0o777;
const SYNC: MainlineSyncConfig = {
  installWhenChanged: [],
  keepIdenticalFiles: true,
  refuseWithUnlanded: true,
};

// Built at a normal umask: a 0644 config and a 0755 script, both tracked.
function project(): Remote {
  process.umask(0o022);
  const origin = remote();
  const seed = clone(origin, "seed-files");
  writeFileSync(join(seed, "config.yml"), "v: 1\n");
  writeFileSync(join(seed, "run.sh"), "#!/bin/sh\necho 1\n");
  chmodSync(join(seed, "run.sh"), 0o755);
  sh(seed, "add", "config.yml", "run.sh");
  sh(seed, "commit", "-q", "-m", "files");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  return origin;
}

// Another clone changes both files on the mainline.
function change(origin: Remote, round: string): void {
  const other = clone(origin, `change-${round}`);
  writeFileSync(join(other, "config.yml"), `v: ${round}\n`);
  writeFileSync(join(other, "run.sh"), `#!/bin/sh\necho ${round}\n`);
  sh(other, "commit", "-q", "-am", `change ${round}`);
  sh(other, "push", "-q", "origin", "HEAD:main");
}

// An untracked secret the way an env tool keeps it: private, never pmcp's to change.
function secret(dir: string): string {
  mkdirSync(join(dir, ".env.d"), { recursive: true });
  const file = join(dir, ".env.d", "app.env");
  writeFileSync(file, "TOKEN=x\n");
  chmodSync(file, 0o600);
  return file;
}

function sync(origin: Remote, umask?: number, report: Reporter = recorder()) {
  process.umask(0o077);
  return syncMainline({
    ctx: detect(origin.main)!,
    sync: SYNC,
    followSubmodules: true,
    stateDir: join(origin.base, "state"),
    report,
    ...(umask !== undefined ? { umask } : {}),
  });
}

it("without [git] umask, a sync at umask 0077 still writes 0600 (the default is unchanged)", () => {
  const origin = project();
  change(origin, "2");
  expect(sync(origin)).toBe(0);
  expect(mode(join(origin.main, "config.yml"))).toBe(0o600);
});

it("with umask 022 a rewritten config ends 0644, a script 0755, and an untracked secret stays 0600", () => {
  const origin = project();
  const env = secret(origin.main);
  change(origin, "2");
  expect(sync(origin, 0o022)).toBe(0);
  expect(mode(join(origin.main, "config.yml"))).toBe(0o644);
  expect(mode(join(origin.main, "run.sh"))).toBe(0o755);
  expect(mode(env)).toBe(0o600);
  expect(process.umask()).toBe(0o077);
});

it("gives rewritten tracked files their index mode back even under a stricter umask", () => {
  const origin = project();
  const env = secret(origin.main);
  change(origin, "2");
  const report = recorder();
  expect(sync(origin, 0o077, report)).toBe(0);
  expect(mode(join(origin.main, "config.yml"))).toBe(0o644);
  expect(mode(join(origin.main, "run.sh"))).toBe(0o755);
  expect(mode(env)).toBe(0o600);
  expect(report.lines).toContain(
    "gave 2 rewritten tracked file(s) their index mode back: config.yml, run.sh",
  );
});

it("does the same in a linked worktree that sync moves", () => {
  const origin = project();
  const desk = join(origin.base, "desk");
  sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk, "origin/main");
  const env = secret(desk);
  change(origin, "2");
  process.umask(0o077);
  const result = syncWorktree({
    ctx: detect(desk)!,
    followSubmodules: false,
    fetch: true,
    report: recorder(),
    umask: 0o077,
  });
  expect(result).toBe("moved");
  expect(mode(join(desk, "config.yml"))).toBe(0o644);
  expect(mode(join(desk, "run.sh"))).toBe(0o755);
  expect(mode(env)).toBe(0o600);
});

it("restores modes inside a submodule checkout the sync moved to its new pin", () => {
  process.umask(0o022);
  const origin = remote();
  const lib = remote();
  const seed = clone(origin, "seed-parent");
  sh(seed, "submodule", "add", "-q", lib.bare, "lib");
  sh(seed, "commit", "-q", "-m", "add lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  sh(origin.main, "submodule", "update", "--init", "-q");
  const other = clone(origin, "bump");
  const sub = join(other, "lib");
  sh(sub, "checkout", "-q", "-B", "main", "origin/main");
  commit(sub, "lib.txt", "v2\n", "lib v2");
  sh(sub, "push", "-q", "origin", "HEAD:main");
  sh(other, "add", "lib");
  sh(other, "commit", "-q", "-m", "bump lib");
  sh(other, "push", "-q", "origin", "HEAD:main");
  expect(sync(origin, 0o077)).toBe(0);
  expect(mode(join(origin.main, "lib", "lib.txt"))).toBe(0o644);
});

it("deliver checks the gate tree out under the umask and restores its modes", () => {
  const origin = project();
  commit(origin.main, "note.txt", "n\n", "add note");
  process.umask(0o077);
  const tree = join(origin.base, "state/gate/tree");
  const code = deliver({
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 1,
      refuseDirectPush: true,
      duringPause: "refuse",
      gate: "command",
      pushEnv: {},
      leaseWaitSeconds: 1,
    },
    gate: { command: ["true"], lockWaitSeconds: 5 } as never,
    tree,
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    report: recorder(),
    umask: 0o022,
  });
  expect(code).toBe(0);
  expect(mode(join(tree, "config.yml"))).toBe(0o644);
  expect(mode(join(tree, "run.sh"))).toBe(0o755);
  expect(mode(join(tree, "note.txt"))).toBe(0o644);
  expect(process.umask()).toBe(0o077);
});

it("reads [git] umask as an octal string", () => {
  const read = (git: Record<string, unknown>) =>
    readGitConfig({
      path: "pmcp.toml",
      dir: "/p",
      raw: { git },
    } as unknown as ProjectConfig);
  expect(read({ umask: "022" })?.umask).toBe(0o022);
  expect(read({ umask: "0027" })?.umask).toBe(0o027);
  expect(read({})?.umask).toBeUndefined();
  expect(() => read({ umask: 18 })).toThrow("octal string");
  expect(() => read({ umask: "999" })).toThrow("octal string");
});
