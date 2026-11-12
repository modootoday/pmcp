import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
import { gitOk } from "../../src/git/exec.js";
import { deliver } from "../../src/git/mainline/deliver.js";
import type { SessionGate } from "../../src/git/mainline/store.js";
import type { GitContext, WorktreesConfig } from "../../src/git/types.js";
import { createWorktree } from "../../src/git/worktrees/create.js";
import { worktreeRows } from "../../src/git/worktrees/list.js";
import { syncWorktree } from "../../src/git/worktrees/sync.js";
import { clone, commit, isolateGit, recorder, remote, sh } from "./fixture.js";

beforeAll(isolateGit);

const open: SessionGate = {
  pause: { read: () => null },
  leases: { read: () => null, take: () => true, release: () => undefined },
};

function config(marker: string): WorktreesConfig {
  return {
    root: ".claude/worktrees",
    branchPrefix: "worktree-",
    aliasPattern: "^[a-z][a-z0-9-]{1,30}$",
    bootstrap: ["sh", "-c", `printf %s "$PMCP_WORKTREE_ALIAS" > ${marker}`],
    linkFromMain: [".env"],
    desks: ".claude/worktrees/*",
  };
}

function desk(alias: string): {
  origin: ReturnType<typeof remote>;
  ctx: GitContext;
  main: GitContext;
} {
  const origin = remote();
  writeFileSync(join(origin.main, ".env"), "LOCAL=1\n");
  const main = detect(origin.main)!;
  const created = createWorktree({
    ctx: main,
    config: config(join(origin.base, "boot")),
    alias,
    report: recorder(),
  });
  return { origin, ctx: detect(created.path)!, main };
}

function advanceOrigin(
  origin: ReturnType<typeof remote>,
  file: string,
): string {
  const other = clone(origin, `other-${file}`);
  const sha = commit(other, file, "upstream\n", `add ${file}`);
  sh(other, "push", "-q", "origin", "HEAD:main");
  return sha;
}

it("creates a worktree on its own branch from the upstream, links host files and bootstraps it", () => {
  const { origin, ctx, main } = desk("alpha");
  expect(ctx.root).toBe(join(origin.main, ".claude/worktrees/alpha"));
  expect(ctx.linked).toBe(true);
  expect(ctx.projectId).toBe(main.projectId);
  expect(sh(ctx.root, "symbolic-ref", "--short", "HEAD")).toBe(
    "worktree-alpha",
  );
  expect(sh(ctx.root, "rev-parse", "HEAD")).toBe(
    sh(origin.main, "rev-parse", "origin/main"),
  );
  expect(lstatSync(join(ctx.root, ".env")).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(origin.base, "boot"), "utf8")).toBe("alpha");
  const rows = worktreeRows(main, config(join(origin.base, "boot")));
  expect(rows.map((row) => row.alias ?? "")).toEqual(["", "alpha"]);
});

it("refuses an alias outside the configured pattern", () => {
  const origin = remote();
  const main = detect(origin.main)!;
  expect(() =>
    createWorktree({
      ctx: main,
      config: config(join(origin.base, "boot")),
      alias: "Bad Alias",
      report: recorder(),
    }),
  ).toThrow(/does not match/u);
});

it("moves a clean worktree up to the upstream", () => {
  const { origin, ctx } = desk("beta");
  const upstream = advanceOrigin(origin, "new.txt");
  expect(
    syncWorktree({ ctx, followSubmodules: true, report: recorder() }),
  ).toBe("moved");
  expect(sh(ctx.root, "rev-parse", "HEAD")).toBe(upstream);
});

it("moves a worktree across a directory that became a gitlink, setting its ignored output aside", () => {
  const { origin, ctx } = desk("split");
  const sub = remote();
  const other = clone(origin, "split-brand");
  commit(other, ".gitignore", "dist/\n", "ignore dist");
  mkdirSync(join(other, "brand"));
  commit(other, "brand/a.txt", "plain\n", "plain brand");
  sh(other, "push", "-q", "origin", "HEAD:main");
  syncWorktree({ ctx, followSubmodules: true, report: recorder() });
  mkdirSync(join(ctx.root, "brand", "dist"));
  writeFileSync(join(ctx.root, "brand", "dist", "out.js"), "built\n");
  sh(other, "rm", "-rq", "brand");
  sh(other, "submodule", "add", "-q", sub.bare, "brand");
  sh(other, "commit", "-q", "-m", "brand becomes a gitlink");
  sh(other, "push", "-q", "origin", "HEAD:main");
  const report = recorder();
  expect(syncWorktree({ ctx, followSubmodules: true, report })).toBe("moved");
  expect(sh(join(ctx.root, "brand"), "rev-parse", "HEAD")).toBe(
    sh(join(other, "brand"), "rev-parse", "HEAD"),
  );
  const line = report.lines.join("\n");
  expect(line).toMatch(
    /brand: new submodule checked out at \w+; its ignored files from before are in /u,
  );
  const moved = /are in (\S+), so run/u.exec(line)?.[1] ?? "";
  expect(
    moved.startsWith(join(process.env["XDG_STATE_HOME"]!, "pmcp", "displaced")),
  ).toBe(true);
  expect(readFileSync(join(moved, "dist", "out.js"), "utf8")).toBe("built\n");
  const common = sh(
    ctx.root,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );
  expect(existsSync(join(common, "pmcp-displaced"))).toBe(false);
});

function deskWithLib(alias: string): {
  origin: ReturnType<typeof remote>;
  ctx: GitContext;
  other: string;
} {
  const { origin, ctx } = desk(alias);
  const sub = remote();
  const other = clone(origin, `${alias}-parent`);
  sh(other, "submodule", "add", "-q", sub.bare, "lib");
  sh(other, "commit", "-q", "-m", "add lib");
  sh(other, "push", "-q", "origin", "HEAD:main");
  syncWorktree({ ctx, followSubmodules: true, report: recorder() });
  return { origin, ctx, other };
}

function bumpLib(origin: ReturnType<typeof remote>, other: string): string {
  const lib = join(other, "lib");
  sh(lib, "checkout", "-q", "-B", "main", "origin/main");
  const next = commit(lib, "lib.txt", "v2\n", "lib v2");
  sh(lib, "push", "-q", "origin", "HEAD:main");
  sh(other, "add", "lib");
  sh(other, "commit", "-q", "-m", "bump lib");
  sh(other, "push", "-q", "origin", "HEAD:main");
  // The main checkout shares the desk's refs, so its fetch leaves the desk's own fetch nothing
  // new and git's on-demand submodule fetch never runs there.
  sh(origin.main, "fetch", "-q", "origin");
  return next;
}

// A module adopted from a bare clone has no fetch refspec, so no fetch records its origin's
// branches and every commit looked unpushed.
it("follows a submodule whose module has no fetch refspec, leaving its config alone", () => {
  const { origin, ctx, other } = deskWithLib("bare");
  const lib = join(ctx.root, "lib");
  sh(lib, "config", "--unset-all", "remote.origin.fetch");
  sh(lib, "update-ref", "-d", "refs/remotes/origin/main");
  sh(lib, "update-ref", "-d", "refs/remotes/origin/HEAD");
  const next = bumpLib(origin, other);
  const report = recorder();
  expect(syncWorktree({ ctx, followSubmodules: true, report })).toBe("moved");
  expect(sh(lib, "rev-parse", "HEAD")).toBe(next);
  expect(gitOk(lib, ["config", "--get", "remote.origin.fetch"])).toBe(false);
});

it("fetches a submodule's new pin that its checkout lacks and moves it there", () => {
  const { origin, ctx, other } = deskWithLib("pins");
  const next = bumpLib(origin, other);
  const report = recorder();
  expect(syncWorktree({ ctx, followSubmodules: true, report })).toBe("moved");
  expect(sh(join(ctx.root, "lib"), "rev-parse", "HEAD")).toBe(next);
  expect(report.lines).toContain(`lib: moved to ${next.slice(0, 10)}`);
});

it("leaves a worktree with uncommitted changes where it is", () => {
  const { origin, ctx } = desk("gamma");
  const before = sh(ctx.root, "rev-parse", "HEAD");
  writeFileSync(join(ctx.root, "README.md"), "edited\n");
  advanceOrigin(origin, "new.txt");
  expect(
    syncWorktree({ ctx, followSubmodules: true, report: recorder() }),
  ).toBe("held");
  expect(sh(ctx.root, "rev-parse", "HEAD")).toBe(before);
});

it("leaves a worktree holding an unlanded commit where it is", () => {
  const { origin, ctx } = desk("delta");
  const own = commit(ctx.root, "own.txt", "mine\n", "own work");
  advanceOrigin(origin, "new.txt");
  expect(
    syncWorktree({ ctx, followSubmodules: true, report: recorder() }),
  ).toBe("held");
  expect(sh(ctx.root, "rev-parse", "HEAD")).toBe(own);
});

it("drops ahead commits that landed as copies and moves to the upstream", () => {
  const { origin, ctx } = desk("epsilon");
  commit(ctx.root, "own.txt", "mine\n", "own work");
  advanceOrigin(origin, "new.txt");
  const code = deliver({
    ctx,
    named: [],
    deliver: {
      attempts: 3,
      refuseDirectPush: true,
      duringPause: "refuse",
      gate: "command",
      pushEnv: {},
      leaseWaitSeconds: 3600,
    },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: open,
    report: recorder(),
  });
  expect(code).toBe(0);
  expect(
    syncWorktree({ ctx, followSubmodules: true, report: recorder() }),
  ).toBe("moved");
  expect(sh(ctx.root, "rev-parse", "HEAD")).toBe(
    sh(ctx.root, "rev-parse", "origin/main"),
  );
  expect(existsSync(join(ctx.root, "own.txt"))).toBe(true);
});
