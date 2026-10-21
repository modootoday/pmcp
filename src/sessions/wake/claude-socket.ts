import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { alive } from "../liveness.js";

// ~/.claude/sessions/<pid>.json names each live Claude session's inbox socket; pmcp only reads it.
export interface ClaudeSessionFile {
  readonly pid?: number;
  readonly sessionId?: string;
  readonly messagingSocketPath?: string;
  readonly status?: string;
}

// The live session file for a session id that names an inbox socket, or null.
export function claudeSocket(
  session: string,
  home: string,
): ClaudeSessionFile | null {
  const dir = join(home, ".claude/sessions");
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).filter((file) =>
    /^\d+\.json$/u.test(file),
  )) {
    try {
      const file = JSON.parse(
        readFileSync(join(dir, name), "utf8"),
      ) as ClaudeSessionFile;
      if (file.sessionId !== session) continue;
      return file.messagingSocketPath && alive(file.pid) ? file : null;
    } catch {
      continue;
    }
  }
  return null;
}
