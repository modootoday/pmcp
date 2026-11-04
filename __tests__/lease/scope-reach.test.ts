import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scoped, userManager } from "../../src/lease/scope.js";
import { leaseToml, pmcpSync, project, scratch, settings } from "./fixture.js";

const always = () => true;
const fine = () => null;

function runtimeDir(socket: "private" | "bus" | null): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-runtime-"));
  if (socket === "private") {
    mkdirSync(join(dir, "systemd"));
    writeFileSync(join(dir, "systemd", "private"), "");
  }
  if (socket === "bus") writeFileSync(join(dir, "bus"), "");
  return dir;
}

describe("the systemd user scope", () => {
  it("treats an unreachable user manager as unavailable", () => {
    const manager = userManager(existsSync, fine, "linux", always);
    expect(manager.unreachable({})).toBe("XDG_RUNTIME_DIR is not set");
    const empty = runtimeDir(null);
    expect(manager.unreachable({ XDG_RUNTIME_DIR: empty })).toBe(
      `no user manager socket in ${empty}`,
    );
    expect(
      manager.unreachable({ XDG_RUNTIME_DIR: runtimeDir("private") }),
    ).toBeNull();
    expect(
      manager.unreachable({ XDG_RUNTIME_DIR: runtimeDir("bus") }),
    ).toBeNull();
    const refused = userManager(
      existsSync,
      () => "Failed to connect to bus: No medium found",
      "linux",
      always,
    );
    expect(refused.unreachable({ XDG_RUNTIME_DIR: runtimeDir("bus") })).toBe(
      "Failed to connect to bus: No medium found",
    );
    expect(
      userManager(existsSync, fine, "linux", () => false).unreachable({}),
    ).toBe("systemd-run is not installed");
    expect(userManager(existsSync, fine, "darwin").unreachable({})).toBe(
      "not Linux",
    );
  });

  it("runs the job without the scope and says why in one line", () => {
    const said: string[] = [];
    const lease = settings("/x");
    const off = { root: tmpdir(), self: "/init.scope" };
    const result = scoped(
      ["make"],
      lease,
      "bulk",
      "1G",
      (line) => said.push(line),
      () => {},
      off,
      userManager(existsSync, fine, "linux", always),
      {},
    );
    expect(result).toEqual({ argv: ["make"] });
    expect(said).toEqual([
      "no systemd user scope (XDG_RUNTIME_DIR is not set); running without MemoryMax=1G",
    ]);
  });

  it("scopes the job when the manager answers, keeping the bare command for a retry", () => {
    const lease = settings("/x");
    const off = { root: tmpdir(), self: "/init.scope" };
    const result = scoped(
      ["make"],
      lease,
      "bulk",
      "1G",
      () => {},
      () => {},
      off,
      userManager(existsSync, fine, "linux", always),
      { XDG_RUNTIME_DIR: runtimeDir("private") },
    );
    expect(result.argv.slice(0, 4)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "-q",
    ]);
    expect(result.argv.slice(-2)).toEqual(["--", "make"]);
    expect(result.unscoped).toEqual(["make"]);
  });
});

describe("pmcp heavy with a memory limit", () => {
  it("runs the command without the scope when no user manager is reachable", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, 'memory_max = "1G"\n'));
    const marker = join(base, "ran");
    delete env["XDG_RUNTIME_DIR"];
    delete env["DBUS_SESSION_BUS_ADDRESS"];
    const result = pmcpSync(
      ["heavy", "--label", "probe", "--", "sh", "-c", `echo ok > ${marker}`],
      cwd,
      env,
    );
    expect(result.status).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ok\n");
    expect(result.stderr).toContain("no systemd user scope");
  });

  it("runs the command again without the scope when systemd-run cannot reach the bus", () => {
    const { base, dir, env } = scratch();
    const cwd = project(base, leaseToml(dir, 'memory_max = "1G"\n'));
    const bin = join(base, "bin");
    mkdirSync(bin);
    // The probe passes, the scoped run itself loses the bus: the race the retry covers.
    writeFileSync(
      join(bin, "systemd-run"),
      '#!/bin/sh\ncase "$*" in\n  *--unit=*) echo "Failed to connect to bus: No such file or directory" >&2; exit 1 ;;\nesac\nexit 0\n',
    );
    chmodSync(join(bin, "systemd-run"), 0o755);
    env["PATH"] = `${bin}:${env["PATH"] ?? ""}`;
    env["XDG_RUNTIME_DIR"] = runtimeDir("bus");
    const marker = join(base, "ran");
    const result = pmcpSync(
      ["heavy", "--label", "probe", "--", "sh", "-c", `echo ok >> ${marker}`],
      cwd,
      env,
    );
    expect(result.status).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ok\n");
    expect(result.stderr).toContain(
      "systemd-run could not reach the user manager; running the command again without the scope",
    );
  });
});
