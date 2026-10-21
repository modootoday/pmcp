import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Hashing policy.json on every tool call cost about 8 ms, mostly loading node:crypto. A verdict
// is reused only while neither file has been written since: ctime moves on every write and
// every touch, and a user cannot set it back. Anything unusual simply hashes again.
const LIMIT = 64;

type Entry = { readonly stamp: string; readonly sha: string };

function cacheFile(): string {
  const base = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(base, "pmcp", "hook-verified.json");
}

function readCache(): Record<string, Entry> {
  try {
    return JSON.parse(readFileSync(cacheFile(), "utf8")) as Record<
      string,
      Entry
    >;
  } catch {
    return {};
  }
}

export function stampOf(paths: readonly string[]): string | null {
  try {
    return paths
      .map((path) => {
        const stat = statSync(path, { bigint: true });
        return `${stat.ino}:${stat.size}:${stat.ctimeNs}`;
      })
      .join("|");
  } catch {
    return null;
  }
}

export function verifiedBefore(key: string, stamp: string, sha: string) {
  const entry = readCache()[key];
  return entry?.stamp === stamp && entry.sha === sha;
}

export function rememberVerified(key: string, stamp: string, sha: string) {
  try {
    const kept = Object.entries(readCache()).filter(([path]) => path !== key);
    const cache = Object.fromEntries([
      ...kept.slice(-(LIMIT - 1)),
      [key, { stamp, sha }],
    ]);
    const file = cacheFile();
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(cache), { mode: 0o600 });
    renameSync(temporary, file);
  } catch {
    // The cache only saves a hash; failing to write it changes nothing else.
  }
}
