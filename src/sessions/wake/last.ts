import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

// The newest woken line per session, read from the tail of the append-only mailbox audit, so
// doctor can show how the last wake went without a registry write that would look like life.
const TAIL_BYTES = 256 * 1024;

export interface LastWake {
  readonly at: string;
  readonly outcome: string;
  readonly via: string;
}

function tail(path: string): string {
  const size = statSync(path).size;
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

export function lastWakes(stateDir: string): Map<string, LastWake> {
  const path = join(stateDir, "messages.jsonl");
  const found = new Map<string, LastWake>();
  if (!existsSync(path)) return found;
  for (const line of tail(path).split("\n")) {
    if (!line.includes('"woken"')) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry["event"] !== "woken" || typeof entry["to"] !== "string")
        continue;
      const via = entry["channel"] ?? entry["transport"] ?? "none";
      found.set(entry["to"], {
        at: String(entry["at"]),
        outcome: String(entry["outcome"]),
        via: String(via),
      });
    } catch {
      continue;
    }
  }
  return found;
}
