import { rmSync } from "node:fs";
import { join } from "node:path";

import { asBroadcast, STATE_FILES } from "../format.js";
import type { Broadcast, SessionStore } from "../types.js";
import { readJson, readLines, writeJson, writeLines } from "./json.js";

// Treat broadcast.json as authoritative so removing it also cancels pending delivery.
export function filesBroadcast(
  dir: string,
  keep: number,
  registry: SessionStore["registry"],
): SessionStore["broadcast"] {
  const latestPath = join(dir, STATE_FILES.broadcast);
  const historyPath = join(dir, STATE_FILES.history);
  const list = (): Broadcast[] => {
    const latest = asBroadcast(readJson(latestPath));
    if (!latest) return [];
    const earlier = readLines<unknown>(historyPath)
      .map(asBroadcast)
      .filter(
        (entry): entry is Broadcast =>
          entry !== null && Number(entry.id) < Number(latest.id),
      );
    return [...earlier, latest];
  };
  return {
    list,
    unseen(session) {
      const record = registry.get(session);
      const own = new Set([session, record?.alias].filter(Boolean));
      const seen = Number(record?.seenBroadcast ?? 0);
      const started = Date.parse(record?.startedAt ?? "") || 0;
      const all = list();
      const latest = all.at(-1);

      const unseen = all.filter(
        (entry) =>
          !own.has(entry.by) &&
          Number(entry.id) > seen &&
          (seen > 0 || entry === latest || Number(entry.id) >= started),
      );
      if (latest && Number(latest.id) > seen)
        registry.upsert(session, { seenBroadcast: latest.id });
      return unseen;
    },
    post({ by, text }) {
      const entry = {
        id: `${Date.now()}`,
        by,
        text,
        since: new Date().toISOString(),
      };
      writeLines(historyPath, [...list(), entry].slice(-keep));
      writeJson(latestPath, entry);
      return entry;
    },
    clear() {
      rmSync(latestPath, { force: true });
      rmSync(historyPath, { force: true });
    },
  };
}
