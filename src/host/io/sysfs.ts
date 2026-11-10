import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseCostLines, type CostLine } from "./model.js";

// Every read takes the sysfs root, so tests give a fixture tree instead of the host's.
export const SYSFS = "/sys";

export function cgroupRoot(sys: string): string {
  return join(sys, "fs", "cgroup");
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export interface LiveCost {
  // Null when the kernel has no io.cost files: cgroup v1, or a kernel built without iocost.
  readonly model: readonly CostLine[] | null;
  readonly qos: readonly CostLine[] | null;
}

export function liveCost(sys: string): LiveCost {
  const model = read(join(cgroupRoot(sys), "io.cost.model"));
  const qos = read(join(cgroupRoot(sys), "io.cost.qos"));
  return {
    model: model === null ? null : parseCostLines(model),
    qos: qos === null ? null : parseCostLines(qos),
  };
}

// Linux packs dev_t as glibc does: 12 bits of major and 20 of minor, split across the word.
export function deviceOf(path: string): string {
  const dev = BigInt(statSync(path, { bigint: true }).dev);
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn);
  const minor = (dev & 0xffn) | ((dev >> 12n) & ~0xffn);
  return `${major}:${minor}`;
}

// io.cost is set per whole disk, so a partition resolves to the disk that holds it.
export function wholeDisk(sys: string, device: string): string {
  const node = join(sys, "dev", "block", device);
  if (!existsSync(join(node, "partition"))) return device;
  try {
    const parent = read(join(dirname(realpathSync(node)), "dev"))?.trim();
    return parent || device;
  } catch {
    return device;
  }
}

// The cgroup directories above a scope, from the root down to its parent, whose
// cgroup.subtree_control lacks io: any one of them leaves the scope's io.weight unread.
export function ioGaps(root: string, scope: string): string[] {
  const parts = scope.split("/").filter(Boolean);
  const gaps: string[] = [];
  for (let at = 0; at < parts.length; at += 1) {
    const rel = parts.slice(0, at);
    const text = read(join(root, ...rel, "cgroup.subtree_control")) ?? "";
    if (!text.split(/\s+/u).includes("io")) gaps.push(`/${rel.join("/")}`);
  }
  return gaps;
}
