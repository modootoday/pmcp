import { existsSync, readFileSync, statSync } from "node:fs";

import { LEVEL_RANK, isLogLevel, type LogLevel } from "./levels.js";
import { logFiles } from "./sinks/file.js";

export interface LogFilter {
  readonly session?: string;
  readonly trace?: string;

  readonly component?: string;

  readonly level?: LogLevel;
  readonly since?: Date;
}

export type LogLine = Record<string, unknown> & {
  ts?: string;
  level?: string;
  component?: string;
};

const UNITS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseSince(value: string, now = Date.now()): Date {
  const match = /^(\d+)([smhd])$/u.exec(value);
  if (match) return new Date(now - Number(match[1]) * UNITS[match[2]!]!);
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    throw new Error(`--since must be like 10m, 2h, 3d or an ISO time`);
  return new Date(time);
}

export function matches(line: LogLine, filter: LogFilter): boolean {
  if (
    filter.session &&
    !String(line["session"] ?? "").startsWith(filter.session)
  )
    return false;
  if (filter.trace && line["trace"] !== filter.trace) return false;
  const component = String(line.component ?? "");
  if (
    filter.component &&
    component !== filter.component &&
    !component.startsWith(`${filter.component}.`)
  )
    return false;
  if (
    filter.level &&
    (!isLogLevel(line.level) ||
      LEVEL_RANK[line.level] > LEVEL_RANK[filter.level])
  )
    return false;
  if (filter.since && Date.parse(line.ts ?? "") < filter.since.getTime())
    return false;
  return true;
}

function parse(text: string): LogLine[] {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((raw) => {
      try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
        return [value as LogLine];
      } catch {
        return [];
      }
    });
}

export function readLogs(
  dir: string,
  filter: LogFilter,
  file?: string,
): LogLine[] {
  const day =
    filter.since?.toISOString().slice(0, 10).replaceAll("-", "") ?? "";
  const files = file
    ? [file]
    : logFiles(dir).filter(
        (path) =>
          path.slice(path.lastIndexOf("/") + 6, path.lastIndexOf("/") + 14) >=
          day,
      );
  return files
    .filter((path) => existsSync(path))
    .flatMap((path) => parse(readFileSync(path, "utf8")))
    .filter((line) => matches(line, filter));
}

export function pretty(line: LogLine): string {
  const where = [line["runtime"], line["event"]].filter(Boolean).join("/");
  const session = String(line["session"] ?? "").slice(0, 8);
  const timing =
    line["duration_ms"] === undefined ? "" : `${String(line["duration_ms"])}ms`;
  const parts = [
    line.ts,
    String(line.level ?? "")
      .toUpperCase()
      .padEnd(5),
    line.component,
    where,
    session,
    line["policy"],
    line["verdict"],
    timing,
    line["msg"],
    line["data"] === undefined ? "" : JSON.stringify(line["data"]),
  ];
  return parts.filter((part) => part !== undefined && part !== "").join(" ");
}

export function tail(
  dir: string,
  state: { file: string; offset: number },
  file?: string,
): LogLine[] {
  const current = file ?? logFiles(dir).at(-1) ?? "";
  if (!current) return [];
  if (current !== state.file) {
    state.file = current;
    state.offset = 0;
  }
  const size = statSync(current).size;
  if (size <= state.offset) return [];
  const text = readFileSync(current, "utf8").slice(state.offset);
  state.offset = size;
  return parse(text);
}
