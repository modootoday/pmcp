import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { checkoutOf } from "../checkout.js";
import { asRecord, STATE_FILES } from "../format.js";
import { isLive } from "../liveness.js";
import type { LiveRecord, SessionRecord, SessionStore } from "../types.js";
import { readJson, writeJson } from "./json.js";

// Underscore admits opencode's ids (ses_...); no allowed character can leave the records dir.
export const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/u;

export function filesRegistry(
  dir: string,
  staleMs: number,
): SessionStore["registry"] {
  const fleetDir = join(dir, STATE_FILES.records);
  const pathOf = (session: string) => join(fleetDir, `${session}.json`);
  const get = (session: string) =>
    SESSION_ID.test(session) ? asRecord(readJson(pathOf(session))) : null;
  const list = (now = Date.now()): LiveRecord[] => {
    let names: string[] = [];
    try {
      names = readdirSync(fleetDir).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
    return names
      .map((name) => asRecord(readJson(join(fleetDir, name))))
      .filter((record): record is SessionRecord => record !== null)
      .map((record) => ({ ...record, live: isLive(record, now, staleMs) }));
  };
  const remove = (session: string) => {
    if (SESSION_ID.test(session)) rmSync(pathOf(session), { force: true });
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
      writeJson(pathOf(session), next);
      return next as SessionRecord;
    },
    sweep(now = Date.now()) {
      const stale = list(now).filter((record) => !record.live);
      stale.forEach((record) => remove(record.session));
      return stale.length;
    },
  };
}
