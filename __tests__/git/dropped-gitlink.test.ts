import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { followPins, updateToPins } from "../../src/git/submodules.js";
import { clone, commit, isolateGit, remote, sh } from "./fixture.js";

beforeAll(isolateGit);

// A parent that pins lib, then a parent commit that removes the gitlink. The returned
// checkout still sits on the old commit with lib checked out.
function droppedLib() {
  const origin = remote();
  const lib = remote();
  const seed = clone(origin, "seed-parent");
  sh(seed, "submodule", "add", "-q", lib.bare, "lib");
  sh(seed, "commit", "-q", "-m", "add lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  const behind = clone(origin, "behind");
  const before = sh(behind, "rev-parse", "HEAD");
  sh(seed, "rm", "-q", "lib");
  sh(seed, "commit", "-q", "-m", "drop lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(behind, "fetch", "-q", "origin");
  const after = sh(behind, "rev-parse", "origin/main");
  return { behind, before, after, dir: join(behind, "lib"), lib };
}

// Moves the parent without touching submodules, as a reset --keep or ff merge does.
function move(behind: string, after: string): void {
  sh(
    behind,
    "-c",
    "submodule.recurse=false",
    "merge",
    "-q",
    "--ff-only",
    after,
  );
}

describe("a gitlink the new commit removes", () => {
  it("is removed by followPins when its checkout is clean and pushed", () => {
    const { behind, before, after, dir } = droppedLib();
    move(behind, after);
    expect(existsSync(dir)).toBe(true);
    const lines = followPins(behind, before, after);
    expect(lines).toEqual([
      "lib: removed: its gitlink is gone, and its checkout was clean with every commit on its origin",
    ]);
    expect(existsSync(dir)).toBe(false);
  });

  it("is kept and named when it has uncommitted changes", () => {
    const { behind, before, after, dir } = droppedLib();
    move(behind, after);
    writeFileSync(join(dir, "draft.txt"), "draft\n");
    expect(followPins(behind, before, after)).toEqual([
      "lib: left as an untracked directory: its gitlink is gone, but it has uncommitted changes",
    ]);
    expect(existsSync(join(dir, "draft.txt"))).toBe(true);
  });

  it("is kept and named when it holds a commit its origin does not have", () => {
    const { behind, before, after, dir } = droppedLib();
    move(behind, after);
    commit(dir, "local.txt", "local\n", "local only");
    expect(followPins(behind, before, after)).toEqual([
      "lib: left as an untracked directory: its gitlink is gone, but it holds commits its origin does not have",
    ]);
    expect(existsSync(dir)).toBe(true);
  });

  it("is kept and named when its git dir is inside it, not the parent's", () => {
    const { behind, before, after, dir, lib } = droppedLib();
    move(behind, after);
    rmSync(dir, { recursive: true, force: true });
    sh(behind, "clone", "-q", lib.bare, "lib");
    expect(followPins(behind, before, after)).toEqual([
      "lib: left as an untracked directory: its gitlink is gone, but its git dir is inside it",
    ]);
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });

  it("is removed by updateToPins instead of reported as a missing pin", () => {
    const { behind, after, dir } = droppedLib();
    move(behind, after);
    expect(updateToPins(behind, ["lib"])).toEqual([
      "lib: removed: its gitlink is gone, and its checkout was clean with every commit on its origin",
    ]);
    expect(existsSync(dir)).toBe(false);
  });
});
