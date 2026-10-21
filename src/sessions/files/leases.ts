import { rmSync } from "node:fs";
import { join } from "node:path";

import { asLease, leaseFile } from "../format.js";
import { alive } from "../liveness.js";
import type { Lease, SessionStore } from "../types.js";
import { readJson, writeJson } from "./json.js";

const leasePath = (dir: string, name: string) => join(dir, leaseFile(name));

export function filesLeases(dir: string): SessionStore["leases"] {
  const read = (name: string): Lease | null => {
    const lease = asLease(readJson(leasePath(dir, name)));
    if (!lease || !alive(lease.pid)) return null;
    return lease;
  };
  return {
    read,
    take(name, lease) {
      const held = read(name);
      const pid = lease.pid ?? process.pid;
      if (held && held.pid !== pid) return false;
      writeJson(leasePath(dir, name), {
        pid,
        subject: lease.subject,
        ...(lease.cwd ? { cwd: lease.cwd } : {}),
        since: new Date().toISOString(),
      });
      return true;
    },
    release(name, pid = process.pid) {
      const held = asLease(readJson(leasePath(dir, name)));
      if (!held || held.pid === pid || !alive(held.pid)) {
        rmSync(leasePath(dir, name), { force: true });
      }
    },
  };
}
