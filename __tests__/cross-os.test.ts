import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { defaultPtySocket } from "../src/harness/adapters/pty/client.js";
import {
  hostVerbUnsupported,
  unsupportedHost,
} from "../src/harness/platform.js";
import {
  flockAvailable,
  lockFile,
  processStart,
  runLocked,
} from "../src/locks/file-lock.js";

function dir(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "pmcp-cross-os-"));
  t.onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

describe("the lock-file lock used where flock does not exist", () => {
  it("holds against a second taker until released", (t) => {
    const path = join(dir(t), "a.lock");
    const held = lockFile(path, 0);
    expect(held).not.toBeNull();
    expect(lockFile(path, 0)).toBeNull();
    held!.release();
    const again = lockFile(path, 0);
    expect(again).not.toBeNull();
    again!.release();
  });

  it("takes over a lock whose owner is gone or whose pid was reused", (t) => {
    const base = dir(t);
    const gone = spawnSync(process.execPath, ["-e", "process.pid"]);
    expect(gone.status).toBe(0);
    const dead = join(base, "dead.lock");
    writeFileSync(dead, JSON.stringify({ pid: gone.pid, start: "x" }));
    lockFile(dead, 0)!.release();
    const reused = join(base, "reused.lock");
    writeFileSync(
      reused,
      JSON.stringify({ pid: process.pid, start: "earlier" }),
    );
    lockFile(reused, 0)!.release();
    const empty = join(base, "empty.lock");
    writeFileSync(empty, "");
    lockFile(empty, 0)!.release();
    expect(processStart(process.pid)).toBeTruthy();
  });
});

describe.runIf(flockAvailable())("runLocked over flock", () => {
  it("answers 73 while another flock holder has the lock, and runs once it is free", async (t) => {
    const lock = join(dir(t), "b.lock");
    const holder = spawn("flock", [lock, "sleep", "2"]);
    t.onTestFinished(() => void holder.kill());
    await new Promise((resolve) => setTimeout(resolve, 300));
    const busy = runLocked(lock, 0, ["true"], { encoding: "utf8" });
    expect(busy.status).toBe(73);
    const waited = runLocked(lock, 5, ["echo", "ran"], { encoding: "utf8" });
    expect([waited.status, waited.stdout.trim()]).toEqual([0, "ran"]);
  });
});

describe("one socket default on every supported system", () => {
  it("follows the host, then the runtime dir, then a private TMPDIR dir on macOS", () => {
    const env = { PMCP_PTY_SOCKET: "/run/h.sock", XDG_RUNTIME_DIR: "/run/u" };
    expect(defaultPtySocket(env, "linux", 7)).toBe("/run/h.sock");
    expect(defaultPtySocket({ XDG_RUNTIME_DIR: "/run/u" }, "darwin", 7)).toBe(
      "/run/u/pmcp-pty.sock",
    );
    expect(defaultPtySocket({ TMPDIR: "/var/folders/x/T/" }, "darwin", 7)).toBe(
      "/var/folders/x/T/pmcp-pty-7/pmcp-pty.sock",
    );
    expect(defaultPtySocket({}, "linux", 7)).toBeUndefined();
  });

  it("refuses Windows and other systems with a plain reason", () => {
    expect(unsupportedHost("linux")).toBeUndefined();
    expect(unsupportedHost("darwin")).toBeUndefined();
    expect(unsupportedHost("win32")).toMatch(/^Windows is not supported yet/u);
    expect(unsupportedHost("freebsd")).toMatch(/not supported yet/u);
  });

  // host up starts pmcp-pty in a systemd scope; on macOS it used to fail inside systemd-run.
  it("keeps host up and host unit to Linux and says what to use instead", () => {
    for (const verb of ["up", "unit"]) {
      expect(hostVerbUnsupported(verb, "linux")).toBeUndefined();
      expect(hostVerbUnsupported(verb, "darwin")).toMatch(
        new RegExp(`^pmcp harness host ${verb} needs Linux.*pmcp tui`, "u"),
      );
    }
    for (const verb of ["approve", "status", "down"])
      expect(hostVerbUnsupported(verb, "darwin")).toBeUndefined();
  });
});
