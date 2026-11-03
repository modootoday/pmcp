import { beforeAll, expect, it } from "vitest";

import { replay } from "../../src/git/mainline/replay.js";
import { clone, commit, isolateGit, remote, sh } from "./fixture.js";

beforeAll(isolateGit);

it("a replay conflict names the files and the way on, without git's cherry-pick hints", () => {
  const origin = remote();
  const ours = commit(origin.main, "README.md", "ours\n", "ours");
  const other = clone(origin, "other");
  commit(other, "README.md", "theirs\n", "theirs");
  sh(other, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "fetch", "-q", "origin");

  const replayed = replay(origin.main, "origin/main", [ours]);

  expect("error" in replayed).toBe(true);
  const error = "error" in replayed ? replayed.error : "";
  expect(error).toContain(
    "the replay conflicts with the upstream in README.md",
  );
  expect(error).toContain("could not apply");
  expect(error).not.toMatch(/^hint:/m);
  expect(error).not.toContain("cherry-pick --continue");
  expect(error).toContain(
    "nothing was pushed; rebase onto origin/main and deliver again",
  );
});
