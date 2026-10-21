// Append synchronously so short-lived hooks cannot lose buffered log records.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import type { LogSink } from "../logger.js";

const FILE = /^pmcp-(\d{8})(?:\.\d+)?\.jsonl$/u;

export function dailyLogFile(dir: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return join(dir, `pmcp-${day}.jsonl`);
}

function roll(file: string): void {
  let index = 1;
  while (existsSync(file.replace(/\.jsonl$/u, `.${index}.jsonl`))) index += 1;
  renameSync(file, file.replace(/\.jsonl$/u, `.${index}.jsonl`));
}

export function fileSink(target: {
  dir: string;
  file?: string;
  maxBytes?: number;
}): LogSink {
  let ready = false;
  return (line) => {
    if (!ready) {
      mkdirSync(target.dir, { recursive: true });
      ready = true;
    }
    const file = target.file ?? dailyLogFile(target.dir);
    if (
      target.maxBytes &&
      existsSync(file) &&
      statSync(file).size + line.length >= target.maxBytes
    )
      roll(file);
    appendFileSync(file, `${line}\n`);
  };
}

export function logFiles(dir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => FILE.test(name));
  } catch {
    return [];
  }
  const part = (name: string) =>
    Number(/\.(\d+)\.jsonl$/u.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return names
    .sort(
      (a, b) =>
        a.slice(5, 13).localeCompare(b.slice(5, 13)) || part(a) - part(b),
    )
    .map((name) => join(dir, name));
}

export function pruneLogs(
  dir: string,
  keepDays: number,
  now = new Date(),
): number {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  let removed = 0;
  for (const file of logFiles(dir)) {
    const day = FILE.exec(file.slice(file.lastIndexOf("/") + 1))?.[1] ?? "";
    if (day >= cutoff) continue;
    rmSync(file, { force: true });
    removed += 1;
  }
  return removed;
}
