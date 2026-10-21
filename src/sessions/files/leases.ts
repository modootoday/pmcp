import {
  linkSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { asLease, leaseFile } from "../format.js";
import type { LeaseFiles } from "../lease-files.js";
import { alive } from "../liveness.js";
import type { Lease, SessionStore } from "../types.js";
import { readJson } from "./json.js";

export function filesLeases(
  dir: string,
  files: Readonly<Record<string, LeaseFiles>> = {},
): SessionStore["leases"] {
  const leasePath = (name: string) =>
    files[name]?.file ?? join(dir, leaseFile(name));
  const read = (name: string): Lease | null => {
    const lease = asLease(readJson(leasePath(name)));
    if (!lease || !alive(lease.pid)) return null;
    return lease;
  };
  return {
    read,
    // Atomic against another process taking the same file (another tool may share it): the
    // record is linked into place, and a dead holder's record is replaced and then re-read, so
    // of two takers replacing it at once only the one whose record stays holds the lease.
    take(name, lease) {
      const path = leasePath(name);
      const pid = lease.pid ?? process.pid;
      const record = {
        pid,
        subject: lease.subject,
        ...(lease.cwd ? { cwd: lease.cwd } : {}),
        since: new Date().toISOString(),
      };
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(temp, `${JSON.stringify(record)}\n`);
      try {
        try {
          linkSync(temp, path);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const held = read(name);
        if (held && held.pid !== pid) return false;
        renameSync(temp, path);
        return asLease(readJson(path))?.pid === pid;
      } finally {
        rmSync(temp, { force: true });
      }
    },
    release(name, pid = process.pid) {
      const path = leasePath(name);
      const held = asLease(readJson(path));
      if (!held || held.pid === pid || !alive(held.pid)) {
        rmSync(path, { force: true });
      }
    },
  };
}
