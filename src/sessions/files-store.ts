// Preserve file layout so existing coordination readers remain compatible during migration.

import { filesBroadcast } from "./files/broadcast.js";
import { filesLeases } from "./files/leases.js";
import { filesMailbox } from "./files/mailbox.js";
import { filesPause } from "./files/pause.js";
import { filesRegistry } from "./files/registry.js";
import { STALE_MS } from "./liveness.js";
import type { MailboxSettings, SessionStore } from "./types.js";
import type { LeaseFiles } from "./lease-files.js";

export interface FilesStoreOptions {
  readonly staleMs?: number;
  readonly keepBroadcasts?: number;
  readonly mailbox?: MailboxSettings;
  // Resolved lease paths by lease name; the others stay <name>-lease.json in dir.
  readonly leaseFiles?: Readonly<Record<string, LeaseFiles>>;
  // The resolved [sessions] pause_file; without it pause.json stays in dir.
  readonly pauseFile?: string;
}

const OFF: MailboxSettings = {
  enabled: false,
  ttlMinutes: 1440,
  maxDelivered: 5,
  audit: true,
};

export function createFilesStore(
  dir: string,
  options: FilesStoreOptions = {},
): SessionStore {
  const registry = filesRegistry(dir, options.staleMs ?? STALE_MS);
  const mailbox = filesMailbox(dir, options.mailbox ?? OFF);
  const broadcast = filesBroadcast(dir, options.keepBroadcasts ?? 10, registry);
  return {
    dir,
    registry,
    pause: filesPause(dir, options.pauseFile),
    leases: filesLeases(dir, options.leaseFiles),
    // With the mailbox on, a broadcast is also a message to all, which the mailbox delivers;
    // broadcast.json stays the record status, snapshot and the Claude band read.
    broadcast: !mailbox.settings.enabled
      ? broadcast
      : {
          ...broadcast,
          post(entry) {
            const posted = broadcast.post(entry);
            mailbox.send({
              from: { alias: entry.by },
              to: ["all"],
              body: entry.text,
              broadcastId: posted.id,
            });
            return posted;
          },
          clear() {
            broadcast.clear();
            mailbox.withdraw((message) => message.broadcastId !== undefined);
          },
        },
    mailbox,
  };
}
