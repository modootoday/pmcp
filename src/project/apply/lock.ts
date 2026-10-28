import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { VERSION } from "../../commands/version.js";
import { lockProblem } from "../../hooks/lock-text.js";
import { ProjectError } from "../package-rules.js";
import type { Output } from "../outputs.js";
import { LOCK_VERSION_KEY } from "../projector.js";
import { replaceFile } from "../write.js";
import type { LockEntry } from "./types.js";

export const LOCK_FILE = "pmcp.lock";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// The whole lock, {} when there is none. One that is not JSON (a merge's conflict markers) is a
// ProjectError saying so and how to restore it.
export function readLockFile(root: string): Record<string, unknown> & {
  outputs?: LockEntry[];
} {
  const path = join(root, LOCK_FILE);
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProjectError(lockProblem(text));
  }
}

export function readLock(root: string): LockEntry[] {
  return readLockFile(root).outputs ?? [];
}

function lockEntry(output: Output): Record<string, unknown> {
  switch (output.kind) {
    case "link":
      return { path: output.path, kind: "link", target: output.target };
    case "file":
      return { path: output.path, kind: "file", sha256: sha(output.content) };
    case "json":
      return {
        path: output.path,
        kind: "json",
        sha256: sha(JSON.stringify(output.value)),
        ...(output.managed ? { managed: output.managed } : {}),
      };
    case "block":
      return { path: output.path, kind: "block", sha256: sha(output.content) };
  }
}

export function writeLock(root: string, outputs: readonly Output[]): void {
  replaceFile(
    join(root, LOCK_FILE),
    `${JSON.stringify({ version: 1, [LOCK_VERSION_KEY]: VERSION, outputs: outputs.filter((output) => output.kind !== "json" || output.managed === undefined || output.managed.length > 0).map(lockEntry) }, null, 2)}\n`,
  );
}
