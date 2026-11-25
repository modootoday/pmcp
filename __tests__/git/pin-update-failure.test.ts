import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  gitlinksBehindPins,
  reportPinsBehind,
} from "../../src/git/pins-behind.js";
import { updateToPins } from "../../src/git/submodules.js";
import { clone, commit, isolateGit, recorder, remote, sh } from "./fixture.js";

beforeAll(isolateGit);

// A parent pinning lib, a checkout of it, then a parent commit that moves the pin forward. The
// checkout's parent is moved without its submodules, so lib sits behind the new pin.
function laggingLib() {
  const origin = remote();
  const lib = remote();
  const seedLib = clone(lib, "seed-lib");
  commit(seedLib, "a.txt", "a\n", "first");
  sh(seedLib, "push", "-q", "origin", "HEAD:main");
  const seed = clone(origin, "seed-parent");
  sh(seed, "submodule", "add", "-q", lib.bare, "lib");
  sh(seed, "commit", "-q", "-m", "add lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  const behind = clone(origin, "behind");
  const oldPin = sh(join(behind, "lib"), "rev-parse", "HEAD");
  commit(seedLib, "b.txt", "b\n", "second");
  sh(seedLib, "push", "-q", "origin", "HEAD:main");
  const libDir = join(seed, "lib");
  sh(libDir, "fetch", "-q", "origin");
  sh(libDir, "checkout", "-q", "origin/main");
  sh(seed, "commit", "-q", "-am", "move lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  const newPin = sh(libDir, "rev-parse", "HEAD");
  sh(behind, "fetch", "-q", "origin");
  sh(
    behind,
    "-c",
    "submodule.recurse=false",
    "merge",
    "-q",
    "--ff-only",
    "origin/main",
  );
  sh(join(behind, "lib"), "fetch", "-q", "origin");
  return { behind, dir: join(behind, "lib"), oldPin, newPin };
}

function lockOf(dir: string): string {
  const gitDir = sh(dir, "rev-parse", "--git-dir");
  return join(isAbsolute(gitDir) ? gitDir : join(dir, gitDir), "index.lock");
}

describe("a gitlink whose update fails", () => {
  it("names git's reason, keeps the lock and is reported behind its pin", () => {
    const { behind, dir, oldPin, newPin } = laggingLib();
    const lock = lockOf(dir);
    writeFileSync(lock, "");
    const [line] = updateToPins(behind, ["lib"]);
    expect(line).toMatch(/^lib: update failed: .*index\.lock/u);
    expect(existsSync(lock)).toBe(true);
    expect(gitlinksBehindPins(behind)).toEqual({
      held: [],
      refused: [
        `lib: at ${oldPin.slice(0, 10)}, behind its pin ${newPin.slice(0, 10)}, with no reason to hold it`,
      ],
    });
  });

  it("fails the report as a refusal, not a hold", () => {
    const { behind, dir } = laggingLib();
    writeFileSync(lockOf(dir), "");
    const report = recorder();
    expect(reportPinsBehind(behind, [], report)).toBe(false);
    expect(report.lines).not.toContain("1 gitlink held behind its pin");
  });

  it("is counted as held, without failing, when it has local edits", () => {
    const { behind, dir, oldPin, newPin } = laggingLib();
    writeFileSync(join(dir, "a.txt"), "edited\n");
    const report = recorder();
    expect(reportPinsBehind(behind, [], report)).toBe(true);
    expect(report.lines).toEqual([
      `lib: held at ${oldPin.slice(0, 10)}, behind its pin ${newPin.slice(0, 10)}: it has uncommitted changes`,
      "1 gitlink held behind its pin",
    ]);
  });

  it("is not reported once it reaches its pin", () => {
    const { behind, newPin } = laggingLib();
    expect(updateToPins(behind, ["lib"])).toEqual([
      `lib: moved to ${newPin.slice(0, 10)}`,
    ]);
    expect(gitlinksBehindPins(behind)).toEqual({ held: [], refused: [] });
  });

  it("is not reported when its checkout is ahead of its pin", () => {
    const { behind, dir } = laggingLib();
    sh(dir, "checkout", "-q", "origin/main");
    commit(dir, "c.txt", "c\n", "local work");
    expect(gitlinksBehindPins(behind)).toEqual({ held: [], refused: [] });
  });
});
