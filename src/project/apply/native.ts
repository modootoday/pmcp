import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { splitKeyed, type Output } from "../outputs.js";
import { ProjectError } from "../package-rules.js";
import { replaceFile } from "../write.js";
import {
  block,
  changedSincePlan,
  deleteKey,
  readJson,
  same,
  setKey,
  withoutBlock,
} from "./_shared.js";
import type { LockEntry } from "./types.js";

// Parse native files before writing so malformed input cannot leave a partial projection.
export function readNativeJson(
  root: string,
  outputs: readonly Output[],
  stale: readonly LockEntry[],
): void {
  const jsonPaths = new Set(
    outputs
      .filter((output) => output.kind === "json")
      .map((output) => output.file),
  );
  for (const entry of stale) {
    const keyed = splitKeyed(entry.path);
    if (entry.kind === "json" && keyed) {
      jsonPaths.add(keyed.file);
    }
  }
  for (const path of jsonPaths) {
    readJson(join(root, path));
  }
}

function writeJson(
  root: string,
  file: string,
  sets: readonly Output[],
  drops: readonly string[][],
): void {
  const abs = join(root, file);
  const before = readJson(abs);
  const after = structuredClone(before);
  for (const key of drops) deleteKey(after, key);
  for (const output of sets) {
    if (output.kind !== "json") {
      continue;
    }
    if (
      output.managed &&
      Array.isArray(output.value) &&
      output.value.length === 0
    ) {
      deleteKey(after, output.key);
    } else {
      setKey(after, output.key, output.value);
    }
  }
  if (same(before, after)) return;
  if (!existsSync(abs) && Object.keys(after).length === 0) return;
  mkdirSync(dirname(abs), { recursive: true });
  replaceFile(abs, `${JSON.stringify(after, null, 2)}\n`);
}

function separator(before: string): string {
  if (before === "" || before.endsWith("\n\n")) return "";
  return before.endsWith("\n") ? "\n" : "\n\n";
}

function writeBlock(root: string, file: string, content: string | null): void {
  const abs = join(root, file);
  const before = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  let after = withoutBlock(before);
  if (content !== null) {
    const sep = separator(after);
    after = `${after}${sep}${block(content)}`;
  }
  if (after === before) return;
  mkdirSync(dirname(abs), { recursive: true });
  replaceFile(abs, after);
}

export function writeNative(
  root: string,
  outputs: readonly Output[],
  stale: readonly LockEntry[],
  basis: ReadonlyMap<string, string> = new Map(),
): number {
  const moved = changedSincePlan(root, basis);
  if (moved.length > 0) throw new ProjectError(moved.join("; "));
  let pruned = 0;
  const jsonFiles = new Map<string, { sets: Output[]; drops: string[][] }>();
  const blockFiles = new Map<string, string | null>();
  for (const output of outputs) {
    if (output.kind === "json") {
      const entry = jsonFiles.get(output.file) ?? { sets: [], drops: [] };
      entry.sets.push(output);
      jsonFiles.set(output.file, entry);
    }
    if (output.kind === "block") blockFiles.set(output.file, output.content);
  }
  for (const entry of stale) {
    const keyed = splitKeyed(entry.path);
    if (keyed && keyed.key.length === 1 && keyed.key[0] === "pmcp") {
      if (!blockFiles.has(keyed.file)) blockFiles.set(keyed.file, null);
    } else if (keyed) {
      const group = jsonFiles.get(keyed.file) ?? { sets: [], drops: [] };
      group.drops.push(keyed.key);
      jsonFiles.set(keyed.file, group);
    } else {
      rmSync(join(root, entry.path), { force: true, recursive: true });
    }
    pruned += 1;
  }
  for (const [file, { sets, drops }] of jsonFiles)
    writeJson(root, file, sets, drops);
  for (const [file, content] of blockFiles) writeBlock(root, file, content);
  return pruned;
}
