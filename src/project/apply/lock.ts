import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { VERSION } from "../../commands/version.js";
import type { Output } from "../outputs.js";
import { LOCK_VERSION_KEY } from "../projector.js";
import { replaceFile } from "../write.js";
import type { LockEntry } from "./types.js";

export const LOCK_FILE = "pmcp.lock";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function readLock(root: string): LockEntry[] {
  const path = join(root, LOCK_FILE);
  if (!existsSync(path)) return [];
  const lock = JSON.parse(readFileSync(path, "utf8")) as {
    outputs?: LockEntry[];
  };
  return lock.outputs ?? [];
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
