import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
  type DeliverReceipt,
} from "../../src/git/mainline/deliver.js";
import { syncMainline } from "../../src/git/mainline/sync.js";
import { syncWorktree } from "../../src/git/worktrees/sync.js";
import {
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], {
  encoding: "utf8",
}).trim();

// A git whose first `git cherry` fails, as a git starved of memory or a lock at load would:
// no output and a non-zero status. Every later call is the real git.
function cherryFailsOnce(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-git-stub-"));
  const mark = join(dir, "failed");
  writeFileSync(
    join(dir, "git"),
    [
      "#!/bin/sh",
      `if [ "$1" = cherry ] && [ ! -e '${mark}' ]; then`,
      `  : > '${mark}'`,
      '  echo "fatal: simulated cherry failure" >&2',
      "  exit 128",
      "fi",
      `exec '${REAL_GIT}' "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${dir}:${process.env["PATH"] ?? ""}`);
  return mark;
}

function options(
  origin: Remote,
  overrides: Partial<DeliverOptions> = {},
): DeliverOptions {
  return {
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 3,
      refuseDirectPush: true,
      duringPause: "refuse",
      gate: "command",
      pushEnv: {},
      leaseWaitSeconds: 3600,
    },
    gate: { command: ["true"], lockWaitSeconds: 60 },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    report: recorder(),
    ...overrides,
  };
}

// A failed read while choosing what is landed must stop the run with its stderr, never read
// as "the upstream already has it" and report nothing to deliver.
describe("a git failure while choosing commits", () => {
  it("stops deliver with exit 2 and the error, and a retry delivers", () => {
    const origin = remote();
    commit(origin.main, "a.txt", "a\n", "add a");
    const before = sh(origin.bare, "rev-parse", "main");
    const mark = cherryFailsOnce();
    try {
      let receipt: DeliverReceipt | null = null;
      const code = deliver(
        options(origin, { onReceipt: (r) => void (receipt = r) }),
      );
      expect(existsSync(mark)).toBe(true);
      expect(code).toBe(2);
      expect(receipt!.delivered).toBeNull();
      expect(receipt!.reason).toContain("simulated cherry failure");
      expect(sh(origin.bare, "rev-parse", "main")).toBe(before);
      expect(deliver(options(origin))).toBe(0);
      expect(sh(origin.bare, "log", "-1", "--format=%s", "main")).toBe("add a");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stops a named delivery the same way", () => {
    const origin = remote();
    const sha = commit(origin.main, "a.txt", "a\n", "add a");
    cherryFailsOnce();
    try {
      const report = recorder();
      expect(deliver(options(origin, { named: [sha], report }))).toBe(2);
      expect(report.lines.join("\n")).toContain("simulated cherry failure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stops sync before it moves the main checkout", () => {
    const origin = remote();
    const head = commit(origin.main, "a.txt", "a\n", "unlanded");
    cherryFailsOnce();
    try {
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
      expect(code).toBe(2);
      expect(report.lines.join("\n")).toContain("simulated cherry failure");
      expect(sh(origin.main, "rev-parse", "HEAD")).toBe(head);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("holds a worktree instead of moving it", () => {
    const origin = remote();
    const desk = join(origin.base, "desk");
    sh(origin.main, "worktree", "add", "-q", "-b", "desk", desk);
    const own = commit(desk, "d.txt", "d\n", "desk work");
    commit(origin.main, "a.txt", "a\n", "add a");
    sh(origin.main, "push", "-q", "origin", "HEAD:main");
    sh(desk, "fetch", "-q", "origin");
    cherryFailsOnce();
    try {
      const report = recorder();
      const result = syncWorktree({
        ctx: detect(desk)!,
        followSubmodules: false,
        fetch: false,
        report,
      });
      expect(result).toBe("held");
      expect(report.lines.join("\n")).toContain("simulated cherry failure");
      expect(sh(desk, "rev-parse", "HEAD")).toBe(own);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
