import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import type { ProjectConfig } from "../../src/config.js";
import { readGitConfig } from "../../src/git/config.js";
import { detect } from "../../src/git/detect.js";
import type { DirToGitlinkPolicy } from "../../src/git/dir-to-gitlink.js";
import { syncMainline } from "../../src/git/mainline/sync.js";
import type { Reporter } from "../../src/git/types.js";
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

const REFUSE: DirToGitlinkPolicy = {
  mode: "refuse",
  hint: "adopt it with the workspace's own sync",
};

// The parent at a commit where brand/ is a tracked directory, before it becomes a gitlink.
function trackedBrand(): { origin: Remote; sub: Remote } {
  const origin = remote();
  const sub = remote();
  const seed = clone(origin, "seed-dir");
  mkdirSync(join(seed, "brand"));
  commit(seed, "brand/a.txt", "plain\n", "plain brand");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  return { origin, sub };
}

// Commits the split in dir: brand/ leaves as files and returns as a gitlink.
function split(dir: string, sub: Remote): void {
  sh(dir, "rm", "-rq", "brand");
  sh(dir, "submodule", "add", "-q", sub.bare, "brand");
  sh(dir, "commit", "-q", "-m", "brand becomes a gitlink");
}

function upstreamSplit(): Remote {
  const { origin, sub } = trackedBrand();
  const seed = join(origin.base, "seed-dir");
  split(seed, sub);
  sh(seed, "push", "-q", "origin", "HEAD:main");
  return origin;
}

function syncMain(
  origin: Remote,
  policy: DirToGitlinkPolicy | undefined,
  report: Reporter,
): number {
  return syncMainline({
    ctx: detect(origin.main)!,
    sync: {
      installWhenChanged: [],
      keepIdenticalFiles: true,
      refuseWithUnlanded: true,
    },
    followSubmodules: true,
    ...(policy === undefined ? {} : { dirToGitlink: policy }),
    stateDir: join(origin.base, "state"),
    report,
  });
}

describe("pmcp git sync across a directory that becomes a gitlink", () => {
  it("refuses with the hint and leaves HEAD and the files where they are", () => {
    const origin = upstreamSplit();
    const before = sh(origin.main, "rev-parse", "HEAD");
    const report = recorder();
    expect(syncMain(origin, REFUSE, report)).toBe(1);
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(origin.main, "brand", "a.txt"), "utf8")).toBe(
      "plain\n",
    );
    expect(report.lines.join("\n")).toContain(
      'the move turns brand from a directory with files into a gitlink ([git.submodules] dir_to_gitlink = "refuse"); left where it is; adopt it with the workspace\'s own sync',
    );
  });

  it("moves and checks the gitlink out under adopt, as before", () => {
    const origin = upstreamSplit();
    const report = recorder();
    expect(syncMain(origin, { mode: "adopt" }, report)).toBe(0);
    expect(existsSync(join(origin.main, "brand", ".git"))).toBe(true);
    expect(existsSync(join(origin.main, "brand", "a.txt"))).toBe(false);
  });

  it("does not refuse when the directory is already gone from the working tree", () => {
    const origin = upstreamSplit();
    rmSync(join(origin.main, "brand"), { recursive: true });
    const report = recorder();
    syncMain(origin, REFUSE, report);
    expect(report.lines.join("\n")).not.toContain("dir_to_gitlink");
  });
});

describe("pmcp git worktree sync across a directory that becomes a gitlink", () => {
  it("holds the worktree under refuse", () => {
    const origin = remote();
    const sub = remote();
    mkdirSync(join(origin.main, "brand"));
    commit(origin.main, "brand/a.txt", "plain\n", "plain brand");
    sh(origin.main, "push", "-q", "origin", "HEAD:main");
    const desk = join(origin.base, "desk");
    sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk, "origin/main");
    split(origin.main, sub);
    sh(origin.main, "push", "-q", "origin", "HEAD:main");
    const before = sh(desk, "rev-parse", "HEAD");
    const report = recorder();
    const result = syncWorktree({
      ctx: detect(desk)!,
      followSubmodules: true,
      dirToGitlink: REFUSE,
      report,
    });
    expect(result).toBe("held");
    expect(sh(desk, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(desk, "brand", "a.txt"), "utf8")).toBe("plain\n");
  });
});

describe("[git.submodules] dir_to_gitlink", () => {
  const read = (submodules: Record<string, unknown>) =>
    readGitConfig({
      path: "pmcp.toml",
      dir: "/repo",
      raw: { git: { submodules } },
    } as unknown as ProjectConfig);

  it("defaults to adopt and carries the hint", () => {
    expect(read({})?.submodules?.dirToGitlink).toBe("adopt");
    const refused = read({
      dir_to_gitlink: "refuse",
      dir_to_gitlink_hint: "x",
    });
    expect(refused?.submodules?.dirToGitlink).toBe("refuse");
    expect(refused?.submodules?.dirToGitlinkHint).toBe("x");
  });

  it("takes only adopt or refuse", () => {
    expect(() => read({ dir_to_gitlink: "skip" })).toThrow(
      "dir_to_gitlink must be adopt | refuse",
    );
    expect(() => read({ dir_to_gitlink_hint: "" })).toThrow(
      "dir_to_gitlink_hint must be a non-empty string",
    );
  });
});

describe("a delivery whose tip turns a directory into a gitlink", () => {
  it("is delivered and leaves the main checkout unmoved under refuse", async () => {
    const { origin, sub } = trackedBrand();
    const state = join(origin.base, "state");
    writeFileSync(
      join(origin.main, "pmcp.toml"),
      `[sessions]\nstate_dir = "${state}"\n[git]\n[git.mainline.deliver]\nattempts = 1\n[git.mainline.sync]\nafter_deliver = "always"\n[git.submodules]\ndir_to_gitlink = "refuse"\n`,
    );
    const topic = join(origin.base, "topic");
    sh(
      origin.main,
      "worktree",
      "add",
      "-q",
      "-b",
      "topic",
      topic,
      "origin/main",
    );
    writeFileSync(
      join(topic, "pmcp.toml"),
      readFileSync(join(origin.main, "pmcp.toml")),
    );
    split(topic, sub);
    const before = sh(origin.main, "rev-parse", "HEAD");
    const out: string[] = [];
    const sink = { write: (text: string) => out.push(text) };
    const ui = new Ui({ env: {}, quiet: false, stdout: sink, stderr: sink });
    const code = await dispatch(["git", "deliver"], {
      cwd: topic,
      ui,
      env: process.env,
    });
    expect(code).toBe(0);
    // Delivery replays the commit, so its hash can differ from topic's; the tree may not.
    expect(sh(origin.bare, "rev-parse", "main^{tree}")).toBe(
      sh(topic, "rev-parse", "HEAD^{tree}"),
    );
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(origin.main, "brand", "a.txt"), "utf8")).toBe(
      "plain\n",
    );
    expect(out.join("")).toContain("only the main checkout did not catch up");
  });
});
