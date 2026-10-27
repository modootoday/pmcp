import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
import { cherry, undelivered } from "../../src/git/landed.js";
import { deliver } from "../../src/git/mainline/deliver.js";
import { syncMainline } from "../../src/git/mainline/sync.js";
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

interface Pins {
  readonly origin: Remote;
  readonly lib: string;
  // lib commits, each on lib's origin: one <- two <- three, and side off one.
  readonly two: string;
  readonly three: string;
  readonly side: string;
}

// The main checkout pins lib at one; lib's origin also has two, three and a side commit.
function withPins(): Pins {
  const origin = remote();
  const libOrigin = remote();
  const work = clone(libOrigin, "lib-work");
  const one = sh(work, "rev-parse", "HEAD");
  const two = commit(work, "lib.txt", "two\n", "two");
  const three = commit(work, "lib.txt", "three\n", "three");
  sh(work, "push", "-q", "origin", "HEAD:main");
  sh(work, "checkout", "-q", "-b", "side", one);
  const side = commit(work, "side.txt", "side\n", "side");
  sh(work, "push", "-q", "origin", "side");
  const seed = clone(origin, "seed-parent");
  sh(seed, "submodule", "add", "-q", libOrigin.bare, "lib");
  sh(join(seed, "lib"), "checkout", "-q", one);
  sh(seed, "add", "lib");
  sh(seed, "commit", "-q", "-m", "add lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  sh(origin.main, "submodule", "update", "--init", "-q");
  sh(join(origin.main, "lib"), "fetch", "-q", "origin", "side");
  return { origin, lib: join(origin.main, "lib"), two, three, side };
}

// A commit in dir that sets lib's pin, and nothing else unless file is named.
function pin(dir: string, sha: string, message: string, file?: string): string {
  sh(dir, "update-index", "--cacheinfo", `160000,${sha},lib`);
  if (file !== undefined) {
    writeFileSync(join(dir, file), `${message}\n`);
    sh(dir, "add", file);
  }
  sh(dir, "commit", "-q", "-m", message);
  return sh(dir, "rev-parse", "HEAD");
}

// Another session delivers a newer pin to the parent's origin.
function peerPins(origin: Remote, sha: string): void {
  const peer = clone(origin, `peer-${sha.slice(0, 6)}`);
  pin(peer, sha, "newer pin");
  sh(peer, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "fetch", "-q", "origin");
}

function sync(origin: Remote): { code: number; lines: string[] } {
  const report = recorder();
  const code = syncMainline({
    ctx: detect(origin.main)!,
    sync: {
      installWhenChanged: [],
      keepIdenticalFiles: true,
      refuseWithUnlanded: true,
    },
    followSubmodules: false,
    stateDir: join(origin.base, "state"),
    report,
  });
  return { code, lines: report.lines };
}

describe("a commit that only moves submodule pins the upstream already reaches", () => {
  it("is landed for cherry and deliver, and sync moves past it keeping edits", () => {
    const { origin, two, three } = withPins();
    const older = pin(origin.main, two, "older pin");
    peerPins(origin, three);
    expect(cherry(origin.main, "origin/main").missing).toEqual([]);
    expect(undelivered(origin.main, "origin/main", [])).toEqual([]);
    expect(undelivered(origin.main, "origin/main", [older])).toEqual([]);
    const report = recorder();
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
      tree: join(origin.base, "state/gate/tree"),
      links: [],
      leases: [],
      store: {
        pause: { read: () => null },
        leases: { read: () => null, take: () => true, release: () => {} },
      },
      report,
    });
    expect(code).toBe(0);
    expect(report.lines).toContain("nothing that origin/main lacks");
    writeFileSync(join(origin.main, "README.md"), "edited\n");
    expect(sync(origin).code).toBe(0);
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(
      sh(origin.main, "rev-parse", "origin/main"),
    );
    expect(readFileSync(join(origin.main, "README.md"), "utf8")).toBe(
      "edited\n",
    );
  });

  it("is landed when the pin equals the upstream's", () => {
    const { origin, three } = withPins();
    pin(origin.main, three, "same pin");
    peerPins(origin, three);
    expect(undelivered(origin.main, "origin/main", [])).toEqual([]);
  });

  it("is landed in a linked worktree that never checked the submodule out", () => {
    const { origin, two, three } = withPins();
    const linked = join(origin.base, "linked");
    sh(origin.main, "worktree", "add", "-q", "-b", "topic", linked);
    pin(linked, two, "older pin");
    peerPins(origin, three);
    expect(undelivered(linked, "origin/main", [])).toEqual([]);
  });

  it("is not landed with any other change, a newer pin, or a pin off the upstream's line", () => {
    const { origin, two, three, side } = withPins();
    peerPins(origin, two);
    const mixed = pin(origin.main, two, "mixed", "other.txt");
    const newer = pin(origin.main, three, "newer");
    const off = pin(origin.main, side, "off line");
    expect(undelivered(origin.main, "origin/main", [])).toEqual([
      mixed,
      newer,
      off,
    ]);
    expect(sync(origin).code).toBe(1);
  });
});
