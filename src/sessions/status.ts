import { spawnSync } from "node:child_process";

import { checkoutOf, hasLinkedWorktrees } from "./checkout.js";
import { restartNotes, type CurrentHooks } from "./hook-freshness.js";
import type { LiveRecord, SessionStore } from "./types.js";

function uncommitted(root: string): string[] {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "-z", "--ignore-submodules=all"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.status !== 0) return [];
  const fields = result.stdout.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]!;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") index += 1;
  }
  return paths;
}

const nameOf = (record: { alias?: string; session: string }) =>
  record.alias || record.session.slice(0, 8);

function sharedLines(store: SessionStore, cwd: string): string[] {
  const records = store.registry.list();
  const roots = new Set(
    [cwd, ...records.map((record) => record.sharedRoot ?? "")].filter(Boolean),
  );
  const lines: string[] = [];
  for (const start of roots) {
    const checkout = checkoutOf(start);
    if (!checkout || !checkout.main || !hasLinkedWorktrees(checkout)) continue;
    const paths = uncommitted(checkout.root);
    if (paths.length === 0) continue;
    lines.push(
      `SHARED CHECKOUT ${checkout.root}: ${paths.length} uncommitted path(s)`,
    );
    for (const path of paths.slice(0, 20)) {
      const owners = records.filter((record) =>
        (record.sharedTouched ?? []).some((entry) => entry.path === path),
      );
      lines.push(`  ${path}  by ${owners.map(nameOf).join(", ") || "unknown"}`);
    }
    roots.delete(checkout.root);
  }
  return lines;
}

export function statusLines(
  store: SessionStore,
  cwd: string,
  leaseNames: readonly string[],
  current?: CurrentHooks,
  wakeable?: (record: LiveRecord) => string | null,
): string[] {
  const lines: string[] = [];
  const pause = store.pause.read();
  if (pause)
    lines.push(`PAUSED by ${pause.by} since ${pause.since}: ${pause.reason}`);
  for (const name of leaseNames) {
    const lease = store.leases.read(name);
    if (lease)
      lines.push(
        `LEASE ${name}: ${lease.subject} (pid ${lease.pid}, since ${lease.since})`,
      );
  }
  const records = store.registry.list();
  const latest = store.broadcast.list().at(-1);
  if (latest) {
    const unseen = records.filter(
      (record) =>
        record.live &&
        record.session !== latest.by &&
        record.alias !== latest.by &&
        Number(record.seenBroadcast ?? 0) < Number(latest.id),
    );
    lines.push(`BROADCAST ${latest.text}`);
    lines.push(`  not seen yet by: ${unseen.map(nameOf).join(", ") || "none"}`);
  }
  lines.push(...sharedLines(store, cwd));
  for (const record of records.filter((entry) => entry.live)) {
    const waiting =
      record.status === "waiting" ? ` (${record.waiting ?? ""})` : "";
    const runtime = record.runtime ? ` ${record.runtime}` : "";
    const transport = wakeable?.(record);
    const wake = transport ? ` wake:${transport}` : "";
    lines.push(
      `${nameOf(record).padEnd(12)} ${String(record.status ?? "").padEnd(8)}${waiting}${runtime}${wake} ${record.branch || "-"} ${record.lastAction ?? ""}`.trimEnd(),
    );
  }
  if (current)
    lines.push(
      ...restartNotes(records, current).map((note) => `RESTART ${note}`),
    );
  return lines;
}
