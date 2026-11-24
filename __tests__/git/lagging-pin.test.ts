import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
import { syncMainline } from "../../src/git/mainline/sync.js";
import { syncWorktree } from "../../src/git/worktrees/sync.js";
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

// The parent pins lib at its second commit; lib's origin also has a third, ahead of the pin.
function pinned(): {
  origin: Remote;
  first: string;
  pin: string;
  ahead: string;
} {
  const origin = remote();
  const lib = remote();
  sh(origin.main, "submodule", "add", "-q", lib.bare, "lib");
  sh(origin.main, "commit", "-q", "-m", "add lib");
  const first = sh(join(origin.main, "lib"), "rev-parse", "HEAD");
  const work = clone(lib, "lib-work");
  const pin = commit(work, "two.txt", "2\n", "lib two");
  sh(work, "push", "-q", "origin", "HEAD:main");
  const ahead = commit(work, "three.txt", "3\n", "lib three");
  sh(work, "push", "-q", "origin", "HEAD:main");
  sh(join(origin.main, "lib"), "fetch", "-q", "origin");
  sh(join(origin.main, "lib"), "checkout", "-q", "--detach", pin);
  sh(origin.main, "commit", "-q", "-am", "move lib");
  sh(origin.main, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "fetch", "-q", "origin");
  return { origin, first, pin, ahead };
}

const headOf = (dir: string): string => sh(dir, "rev-parse", "HEAD");

describe("a checkout left behind its pin by a move pmcp did not make", () => {
  it("follows its pin when the main checkout is already current", () => {
    const { origin, first, pin } = pinned();
    sh(join(origin.main, "lib"), "checkout", "-q", "--detach", first);
    const report = recorder();
    const code = syncMainline({
      ctx: detect(origin.main)!,
      sync: {
        installWhenChanged: [],
        keepIdenticalFiles: true,
        refuseWithUnlanded: true,
      },
      followSubmodules: true,
      stateDir: join(origin.base, "state"),
      report,
    });
    expect(code).toBe(0);
    expect(headOf(join(origin.main, "lib"))).toBe(pin);
    expect(report.lines).toContain(
      `lib: behind its pin; moved to ${pin.slice(0, 10)}`,
    );
  });

  it("follows its pin in a linked worktree that is already current", () => {
    const { origin, first, pin } = pinned();
    const desk = join(origin.base, "desk");
    sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk, "origin/main");
    sh(desk, "submodule", "update", "-q", "--init");
    sh(join(desk, "lib"), "checkout", "-q", "--detach", first);
    const result = syncWorktree({
      ctx: detect(desk)!,
      followSubmodules: true,
      fetch: true,
      report: recorder(),
    });
    expect(result).toBe("current");
    expect(headOf(join(desk, "lib"))).toBe(pin);
  });

  it("leaves a checkout ahead of its pin, or one with a staged pin move, where it is", () => {
    const { origin, first, ahead } = pinned();
    const lib = join(origin.main, "lib");
    const sync = () =>
      syncMainline({
        ctx: detect(origin.main)!,
        sync: {
          installWhenChanged: [],
          keepIdenticalFiles: true,
          refuseWithUnlanded: true,
        },
        followSubmodules: true,
        stateDir: join(origin.base, "state"),
        report: recorder(),
      });
    sh(lib, "checkout", "-q", "--detach", ahead);
    expect(sync()).toBe(0);
    expect(headOf(lib)).toBe(ahead);
    sh(lib, "checkout", "-q", "--detach", first);
    sh(origin.main, "add", "lib");
    sync();
    expect(headOf(lib)).toBe(first);
  });

  it("leaves it alone when submodules are not followed", () => {
    const { origin, first } = pinned();
    const desk = join(origin.base, "desk");
    sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk, "origin/main");
    sh(desk, "submodule", "update", "-q", "--init");
    sh(join(desk, "lib"), "checkout", "-q", "--detach", first);
    syncWorktree({
      ctx: detect(desk)!,
      followSubmodules: false,
      fetch: true,
      report: recorder(),
    });
    expect(headOf(join(desk, "lib"))).toBe(first);
  });
});
