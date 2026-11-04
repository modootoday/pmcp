import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Every test run gets its own temp, state, cache and config roots, removed afterwards, so no
// test can leave fixtures in the real temp directory or write the real pmcp state. The
// teardown fails the run when something still did.

function names(dir: string, keep: (name: string) => boolean): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter(keep));
}

export default function setup(): () => void {
  const realTmp = tmpdir();
  const realState = join(
    process.env["XDG_STATE_HOME"] || join(homedir(), ".local", "state"),
    "pmcp",
    "projects",
  );
  const isPmcp = (name: string) => name.startsWith("pmcp-");
  const before = {
    tmp: names(realTmp, isPmcp),
    state: names(realState, () => true),
  };
  const root = mkdtempSync(join(realTmp, "vitest-isolation-"));
  const dirs = {
    TMPDIR: join(root, "tmp"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_CONFIG_HOME: join(root, "config"),
  };
  for (const [name, dir] of Object.entries(dirs)) {
    mkdirSync(dir, { recursive: true });
    process.env[name] = dir;
  }
  return () => {
    rmSync(root, { recursive: true, force: true });
    const leaked = [
      ...[...names(realTmp, isPmcp)]
        .filter((name) => !before.tmp.has(name))
        .map((name) => join(realTmp, name)),
      ...[...names(realState, () => true)]
        .filter((name) => !before.state.has(name))
        .map((name) => join(realState, name)),
    ];
    if (leaked.length > 0)
      throw new Error(
        `tests left ${leaked.length} path(s) outside their fixture:\n${leaked.slice(0, 20).join("\n")}`,
      );
  };
}
