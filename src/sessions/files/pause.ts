import { rmSync } from "node:fs";
import { join } from "node:path";

import { asPause, STATE_FILES } from "../format.js";
import type { SessionStore } from "../types.js";
import { readJson, writeJson } from "./json.js";

// file is [sessions] pause_file, resolved; without it the pause lives in the state dir.
export function filesPause(dir: string, file?: string): SessionStore["pause"] {
  const path = file ?? join(dir, STATE_FILES.pause);
  return {
    read: () => asPause(readJson(path)),
    write(pause) {
      if (!pause) {
        rmSync(path, { force: true });
        return;
      }
      writeJson(path, {
        by: pause.by,
        reason: pause.reason,
        since: new Date().toISOString(),
      });
    },
  };
}
