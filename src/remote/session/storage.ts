import {
  chmodSync,
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StoredSession } from "./types.js";
export function globalDir(
  home = homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const xdg = env["XDG_CONFIG_HOME"];
  return xdg !== undefined && xdg !== ""
    ? join(xdg, "pmcp")
    : join(home, ".pmcp");
}
export const sessionPath = (home?: string): string =>
  join(globalDir(home), "session.json");
export function readSession(home?: string): StoredSession | null {
  try {
    return JSON.parse(readFileSync(sessionPath(home), "utf8")) as StoredSession;
  } catch {
    return null;
  }
}
export function writeSession(session: StoredSession, home?: string): void {
  const path = sessionPath(home);
  const directory = globalDir(home);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const fd = openSync(path, "w", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `${JSON.stringify(session, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
}
export function clearSession(home?: string): void {
  try {
    rmSync(sessionPath(home));
  } catch {}
}
