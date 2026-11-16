import { existsSync, readFileSync } from "node:fs";

import type { LogFilter, LogLine } from "../logging/query.js";
import type { LeasePaths } from "./files.js";

// heavy.log keeps its tab-separated protocol, shared with shell wrappers, and usage.jsonl keeps
// what pmcp heavy stats reads; pmcp logs --component lease reads both as log records instead.
const WARN_EVENTS = new Set(["timeout", "skip-refused", "skip-invalid"]);

export function wantsLease(filter: LogFilter): boolean {
  const component = filter.component;
  return component === "lease" || component?.startsWith("lease.") === true;
}

function lines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean);
}

// "waited=3 cwd=/w label=bun install lane=bulk": a value runs until the next key=.
export function detailFields(detail: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of detail.split(/\s(?=[a-z_]+=)/u)) {
    const at = part.indexOf("=");
    if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
  }
  return fields;
}

function eventRecords(path: string): LogLine[] {
  return lines(path).flatMap((line) => {
    const [ts, pid, event, detail = ""] = line.split("\t");
    if (!ts || !event) return [];
    return [
      {
        ts,
        level: WARN_EVENTS.has(event) ? "warn" : "info",
        component: "lease",
        msg: event,
        data: { pid: Number(pid), ...detailFields(detail) },
      },
    ];
  });
}

function usageRecords(path: string): LogLine[] {
  return lines(path).flatMap((line) => {
    try {
      const { at, outcome, ...rest } = JSON.parse(line) as Record<
        string,
        unknown
      >;
      if (typeof at !== "string") return [];
      return [
        {
          ts: at,
          level: "info",
          component: "lease.usage",
          msg: String(outcome ?? "ran"),
          data: rest,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function leaseLogRecords(paths: LeasePaths): LogLine[] {
  return [...eventRecords(paths.log), ...usageRecords(paths.usage)];
}
