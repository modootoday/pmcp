import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { checkoutOf } from "../checkout.js";
import { asRecord, latestRecord, STATE_FILES } from "../format.js";
import { isLive } from "../liveness.js";
import type { LiveRecord, SessionRecord, SessionStore } from "../types.js";
import { readJson, writeJson } from "./json.js";

// Underscore admits opencode's ids (ses_...); no allowed character can leave the records dir.
export const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/u;

export function filesRegistry(
  dir: string,
  staleMs: number,
): SessionStore["registry"] {
  // Every record is kept in sessions/ and in the deprecated fleet/. A pmcp before 0.20 sharing
  // this directory updates fleet/ alone, so of two copies the one updated last is the record.
  const dirs = [STATE_FILES.records, STATE_FILES.legacyRecords].map((name) =>
    join(dir, name),
  );
  const pathsOf = (session: string) =>
    dirs.map((records) => join(records, `${session}.json`));
  const get = (session: string) => {
    if (!SESSION_ID.test(session)) return null;
    return latestRecord(
      pathsOf(session).map((path) => asRecord(readJson(path))),
    );
  };
  const list = (now = Date.now()): LiveRecord[] => {
    const found = new Map<string, (SessionRecord | null)[]>();
    for (const folder of dirs) {
      let names: string[] = [];
      try {
        names = readdirSync(folder).filter((name) => name.endsWith(".json"));
      } catch {
        continue;
      }
      for (const name of names)
        found.set(name, [
          ...(found.get(name) ?? []),
          asRecord(readJson(join(folder, name))),
        ]);
    }
    return [...found.values()]
      .map(latestRecord)
      .filter((record): record is SessionRecord => record !== null)
      .map((record) => ({ ...record, live: isLive(record, now, staleMs) }));
  };
  const remove = (session: string) => {
    if (!SESSION_ID.test(session)) return;
    for (const path of pathsOf(session)) rmSync(path, { force: true });
  };
  return {
    get,
    list,
    remove,
    upsert(session, fields) {
      if (!SESSION_ID.test(session)) return null;
      const now = new Date().toISOString();
      const previous = get(session) ?? { session, startedAt: now };
      const next: Record<string, unknown> = {
        ...previous,
        ...fields,
        updatedAt: now,
      };

      if (typeof fields.cwd === "string" && fields.cwd !== previous.cwd) {
        const checkout = checkoutOf(fields.cwd);
        next["worktree"] = checkout?.root ?? "";
        next["branch"] = checkout?.branch ?? "";
      }
      // Both copies, the new path first; each write is a temporary file and a rename.
      for (const path of pathsOf(session)) writeJson(path, next);
      return next as SessionRecord;
    },
    sweep(now = Date.now()) {
      const stale = list(now).filter((record) => !record.live);
      stale.forEach((record) => remove(record.session));
      return stale.length;
    },
  };
}
