import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { mainlineSync } from "../../src/git/config/tables.js";
import {
  installIfStale,
  installState,
  type InstallSpec,
} from "../../src/git/install.js";
import { deliveryEvents } from "../../src/git/mainline/delivery-events.js";
import type { GitSetup } from "../../src/git/setup.js";
import { recorder } from "./fixture.js";

// Another tool reads and writes the same install stamp: <git dir>/<name> holding the sha256 of
// the lock file's bytes. Sharing it keeps both from reinstalling after the other installed.
let repo = "";
let desk = "";
const lock = "lock v1\n";
const plain = createHash("sha256").update(lock).digest("hex");

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "pmcp-stamp-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "bun.lock"), lock);
  git("add", "bun.lock");
  git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-q",
    "-m",
    "lock",
  );
  desk = `${repo}-desk`;
  git("worktree", "add", "-q", desk);
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(desk, { recursive: true, force: true });
});

function spec(marker: string): InstallSpec {
  return {
    command: ["sh", "-c", `echo ran >> ${marker}`],
    when: ["bun.lock"],
    stateDir: join(repo, ".state"),
    stamp: { path: "${git_dir}/shared-installed-lock", hash: "plain" },
  };
}

it("reads stamp and stamp_hash, and needs one lock file for plain", () => {
  expect(
    mainlineSync("pmcp.toml", {
      install: ["bun", "install"],
      install_when_changed: ["bun.lock"],
      stamp: "${git_dir}/shared-installed-lock",
      stamp_hash: "plain",
    }).stamp,
  ).toEqual({ path: "${git_dir}/shared-installed-lock", hash: "plain" });
  expect(() =>
    mainlineSync("pmcp.toml", {
      install_when_changed: ["bun.lock", "package.json"],
      stamp: "${git_dir}/x",
      stamp_hash: "plain",
    }),
  ).toThrow("exactly one install_when_changed path");
  expect(() =>
    mainlineSync("pmcp.toml", {
      install_when_changed: ["bun.lock"],
      stamp: "state/x",
    }),
  ).toThrow("must start with ${git_dir}/");
  expect(mainlineSync("pmcp.toml", {}).stamp).toBeUndefined();
});

it("writes the plain hash to the checkout's own git dir, and honours one the other tool wrote", () => {
  const marker = join(repo, "..", `${repo.split("/").pop()}-ran`);
  const stamp = join(repo, ".git", "shared-installed-lock");
  expect(installIfStale(repo, spec(marker), recorder())).toBe(0);
  expect(readFileSync(stamp, "utf8").trim()).toBe(plain);
  expect(installIfStale(repo, spec(marker), recorder())).toBeNull();
  expect(readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(1);

  // A linked worktree has its own git dir and so its own stamp; one the other tool already
  // wrote there for this lock means no install.
  const deskGitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: desk,
    encoding: "utf8",
  }).trim();
  writeFileSync(join(deskGitDir, "shared-installed-lock"), `${plain}\n`);
  expect(installIfStale(desk, spec(marker), recorder())).toBeNull();
  expect(installState(desk, spec(marker))).toEqual({
    hash: plain,
    installed: true,
  });
  rmSync(marker, { force: true });
});

it("records the same hash and installed state in the delivery event", () => {
  const events = join(repo, "..", `${repo.split("/").pop()}-events.jsonl`);
  const setup = {
    config: {
      leases: [{ name: "lockfile", paths: ["bun.lock"] }],
      sync: {
        install: ["true"],
        installWhenChanged: ["bun.lock"],
        stamp: { path: "${git_dir}/shared-installed-lock", hash: "plain" },
      },
    },
    ctx: { mainRoot: repo },
    stateDir: join(repo, ".state"),
    leaseFiles: { lockfile: { events } },
  } as unknown as GitSetup;
  deliveryEvents(setup)({
    leases: ["lockfile"],
    subject: "lock",
    commit: "abcdef0123",
  });
  const line = JSON.parse(readFileSync(events, "utf8").trim());
  expect(line).toMatchObject({ hash: plain, installed: true });
  rmSync(events, { force: true });
  expect(existsSync(events)).toBe(false);
});
