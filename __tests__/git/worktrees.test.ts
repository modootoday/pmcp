import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
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
