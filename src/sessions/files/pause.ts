import { rmSync } from "node:fs";
import { join } from "node:path";

import { asPause, STATE_FILES } from "../format.js";
import type { SessionStore } from "../types.js";
import { readJson, writeJson } from "./json.js";

export function filesPause(dir: string): SessionStore["pause"] {
  const path = join(dir, STATE_FILES.pause);
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
