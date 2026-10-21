import type { SessionStore } from "./types.js";

export function sessionSnapshot(
  store: SessionStore,
  leaseNames: readonly string[],
) {
  const live = store.registry.list().filter((record) => record.live);
  const all = store.broadcast.list();
  const broadcasts = all.map((entry) => ({
    ...entry,
    unseenBy: live
      .filter((record) => {
        if (record.session === entry.by || record.alias === entry.by)
          return false;
        const seen = Number(record.seenBroadcast ?? 0);
        if (Number(entry.id) <= seen) return false;
        const started = Date.parse(record.startedAt ?? "") || 0;
        return seen > 0 || entry === all.at(-1) || Number(entry.id) >= started;
      })
      .map((record) => record.session),
  }));
  const leases = leaseNames.flatMap((name) => {
    const lease = store.leases.read(name);
    return lease ? [{ name, ...lease }] : [];
  });
  return {
    version: 1 as const,
    live,
    pause: store.pause.read(),
    leases,
    broadcasts,
  };
}
