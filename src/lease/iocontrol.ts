import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// cgroup v2 io weights for leased jobs. Each job runs in its own user scope; where the io
// controller reaches that scope (delegated to the user manager), the job's lane sets its
// io.weight and optional io.max. Elsewhere nothing changes.

export interface CgroupHost {
  readonly root: string;
  readonly self: string;
}

export function cgroupHost(): CgroupHost {
  let self = "";
  try {
    const line = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("0::"));
    self = line?.slice(3) ?? "";
  } catch {
    // No cgroup v2 here.
  }
  return { root: "/sys/fs/cgroup", self };
}

function controllers(dir: string): string[] {
  try {
    return readFileSync(join(dir, "cgroup.controllers"), "utf8")
      .trim()
      .split(/\s+/u);
  } catch {
    return [];
  }
}

// The user manager's cgroup must offer io, or a scope under it can never get it.
export function ioDelegated(host: CgroupHost): boolean {
  const parts = host.self.split("/").filter(Boolean);
  const at = parts.findIndex((part) => /^user@\d+\.service$/u.test(part));
  if (at < 0) return false;
  const manager = join(host.root, ...parts.slice(0, at + 1));
  return controllers(manager).includes("io");
}

function enable(dir: string): void {
  const file = join(dir, "cgroup.subtree_control");
  try {
    if (readFileSync(file, "utf8").split(/\s+/u).includes("io")) return;
    writeFileSync(file, "+io");
  } catch {
    // Not ours to change; the controllers check below decides.
  }
}

export interface IoApplied {
  // Whether the lane's io.weight was written.
  readonly weight: boolean;
  // The io.max line: written, none configured, or refused.
  readonly max: "set" | "unset" | "failed";
}

// Turns io on down every parent of the scope, then writes io.weight and io.max into the scope
// itself: a user manager records IOWeight and IO*Max properties without applying them.
export function applyIo(
  host: CgroupHost,
  scope: string,
  weight: number,
  max: string | undefined,
): IoApplied {
  const parts = scope.split("/").filter(Boolean);
  for (let at = 1; at < parts.length; at += 1)
    enable(join(host.root, ...parts.slice(0, at)));
  const dir = join(host.root, ...parts);
  if (!controllers(dir).includes("io"))
    return { weight: false, max: max ? "failed" : "unset" };
  const write = (file: string, text: string) => {
    try {
      writeFileSync(join(dir, file), text);
      return true;
    } catch {
      return false;
    }
  };
  const written = write("io.weight", `default ${weight}`);
  if (!max) return { weight: written, max: "unset" };
  return { weight: written, max: write("io.max", max) ? "set" : "failed" };
}

// The unit is named with its .scope suffix: systemctl show takes a bare name as a .service.
export function scopeCgroup(unit: string): string | null {
  const run = spawnSync(
    "systemctl",
    ["--user", "show", `${unit}.scope`, "-p", "ControlGroup", "--value"],
    { encoding: "utf8" },
  );
  const path = run.status === 0 ? run.stdout.trim() : "";
  return path || null;
}
