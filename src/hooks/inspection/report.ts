// Summarise the guard log lines the hook bundle writes at debug level. Reads the log only; it
// never sees commands, prompts or transcripts, since the hook does not log them.

import type { LogLine } from "../../logging/query.js";

export interface ReportSettings {
  readonly excludeSessions: readonly RegExp[];
}

export function readReportTable(value: unknown): ReportSettings {
  if (value === undefined) return { excludeSessions: [] };
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("[hooks.report] must be a table");
  const table = value as Record<string, unknown>;
  const unknown = Object.keys(table).find((key) => key !== "exclude_sessions");
  if (unknown) throw new Error(`unknown [hooks.report] key ${unknown}`);
  const list = table["exclude_sessions"] ?? [];
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string"))
    throw new Error(
      "[hooks.report] exclude_sessions must be a list of regexes",
    );
  return {
    excludeSessions: list.map((source) => {
      try {
        return new RegExp(source as string, "u");
      } catch {
        throw new Error(
          `[hooks.report] exclude_sessions has an invalid regex ${source as string}`,
        );
      }
    }),
  };
}

export interface GuardRow {
  readonly policy: string;
  readonly runtime: string;
  readonly calls: number;
  // What the guard found, before its mode, and what the call got.
  readonly raw: Readonly<Record<string, number>>;
  readonly verdict: Readonly<Record<string, number>>;
  readonly modes: readonly string[];
  readonly sessions: number;
  readonly durationMs: {
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
  };
}

export interface Report {
  readonly lines: number;
  readonly sessions: number;
  readonly excluded: number;
  readonly guards: readonly GuardRow[];
}

// One evaluated guard: the line run-policy writes after a guard decided.
export interface GuardLine {
  readonly ts: string;
  readonly policy: string;
  readonly runtime: string;
  readonly session: string;
  readonly mode: string;
  readonly raw: string;
  readonly verdict: string;
  readonly tool?: string;
  readonly durationMs: number;
}

export function guardLines(
  lines: readonly LogLine[],
  settings: ReportSettings,
): { kept: GuardLine[]; excluded: number } {
  const kept: GuardLine[] = [];
  let excluded = 0;
  for (const line of lines) {
    if (line.component !== "hooks.entry" || line["msg"] !== "policy") continue;
    const data = (line["data"] ?? {}) as Record<string, unknown>;
    if (typeof line["policy"] !== "string" || typeof data["raw"] !== "string")
      continue;
    const session = String(line["session"] ?? "");
    if (settings.excludeSessions.some((pattern) => pattern.test(session))) {
      excluded += 1;
      continue;
    }
    kept.push({
      ts: String(line.ts ?? ""),
      policy: line["policy"],
      runtime: String(line["runtime"] ?? ""),
      session,
      mode: String(data["mode"] ?? ""),
      raw: data["raw"],
      verdict: String(line["verdict"] ?? "allow"),
      ...(typeof data["tool"] === "string" ? { tool: data["tool"] } : {}),
      durationMs: Number(line["duration_ms"] ?? 0),
    });
  }
  return { kept, excluded };
}

function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(share * sorted.length) - 1),
  );
  return sorted[index]!;
}

const count = (into: Record<string, number>, key: string) => {
  into[key] = (into[key] ?? 0) + 1;
};

export function report(lines: readonly GuardLine[], excluded: number): Report {
  const groups = new Map<string, GuardLine[]>();
  for (const line of lines) {
    const key = `${line.policy}\u0000${line.runtime}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const guards = [...groups.values()].map((group): GuardRow => {
    const raw: Record<string, number> = {};
    const verdict: Record<string, number> = {};
    for (const line of group) {
      count(raw, line.raw);
      count(verdict, line.verdict);
    }
    const durations = group
      .map((line) => line.durationMs)
      .sort((a, b) => a - b);
    return {
      policy: group[0]!.policy,
      runtime: group[0]!.runtime,
      calls: group.length,
      raw,
      verdict,
      modes: [...new Set(group.map((line) => line.mode))].sort(),
      sessions: new Set(group.map((line) => line.session)).size,
      durationMs: {
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: durations.at(-1) ?? 0,
      },
    };
  });
  guards.sort(
    (a, b) =>
      a.policy.localeCompare(b.policy) || a.runtime.localeCompare(b.runtime),
  );
  return {
    lines: lines.length,
    sessions: new Set(lines.map((line) => line.session)).size,
    excluded,
    guards,
  };
}

// The calls a guard found something in but did not refuse, because its mode is observe or warn:
// what switching it to deny would have refused.
export function wouldRefuse(
  lines: readonly GuardLine[],
  policy: string,
): GuardLine[] {
  return lines.filter(
    (line) =>
      line.policy === policy &&
      line.raw !== "allow" &&
      line.verdict !== "deny" &&
      line.verdict !== line.raw,
  );
}
