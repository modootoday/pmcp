import { estimateTokens } from "./tokens.js";

export type TokenAuditStatus = "ok" | "warn" | "compact" | "block";

export type AdvisorySeverity = "info" | "warning" | "critical";

export interface TokenThresholds {
  readonly warn_at?: number;
  readonly compact_at?: number;
  readonly block_at?: number;
  readonly warnAt?: number;
  readonly compactAt?: number;
  readonly blockAt?: number;
  readonly max_tokens?: number;
  readonly maxTokens?: number;
}

export interface ResolvedTokenThresholds {
  readonly warn_at?: number;
  readonly compact_at?: number;
  readonly block_at?: number;
  readonly max_tokens?: number;
}

export interface TokenHeadroom {
  readonly untilWarn?: number;
  readonly untilCompact?: number;
  readonly untilBlock?: number;
}

export interface CompactNudgeAdvisory {
  readonly needed: boolean;
  readonly severity: AdvisorySeverity;
  readonly message: string;
  readonly suggestedAction: string;
  readonly currentTokens: number;
  readonly compactAt?: number;
  readonly blockAt?: number;
  readonly tokensOverCompact?: number;
  readonly headroomUntilBlock?: number;
}

export interface SessionTokenUsage {
  readonly session?: string;
  readonly turns: number;
  readonly totalTokens: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface TranscriptTurn {
  readonly role?: string;
  readonly content?: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly tokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly [key: string]: unknown;
}

export interface TranscriptPayload {
  readonly session?: string;
  readonly sessionId?: string;
  readonly turns?: readonly TranscriptTurn[];
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly [key: string]: unknown;
}

export interface SessionAuditReport {
  readonly session?: string;
  readonly status: TokenAuditStatus;
  readonly totalTokens: number;
  readonly turns: number;
  readonly thresholds: ResolvedTokenThresholds;
  readonly breached: readonly ("warn_at" | "compact_at" | "block_at")[];
  readonly headroom: TokenHeadroom;
  readonly advisory: CompactNudgeAdvisory;
  readonly usage?: SessionTokenUsage;
}

export interface SessionBatchAuditReport {
  readonly totalSessions: number;
  readonly status: TokenAuditStatus;
  readonly totalTokens: number;
  readonly summaries: readonly SessionAuditReport[];
  readonly advisories: readonly CompactNudgeAdvisory[];
  readonly breachedCount: {
    readonly warn: number;
    readonly compact: number;
    readonly block: number;
  };
}

// Support both snake_case and camelCase config keys while resolving fractional thresholds against max_tokens.
export function resolveThresholds(
  raw: TokenThresholds,
): ResolvedTokenThresholds {
  const max_tokens = raw.max_tokens ?? raw.maxTokens;
  const resolve = (val: number | undefined): number | undefined => {
    if (val === undefined || Number.isNaN(val)) return undefined;
    if (max_tokens !== undefined && val > 0 && val <= 1) {
      return Math.round(val * max_tokens);
    }
    return Math.round(val);
  };

  return {
    warn_at: resolve(raw.warn_at ?? raw.warnAt),
    compact_at: resolve(raw.compact_at ?? raw.compactAt),
    block_at: resolve(raw.block_at ?? raw.blockAt),
    ...(max_tokens !== undefined ? { max_tokens: Math.round(max_tokens) } : {}),
  };
}

// Parse transcript entries, JSONL logs, or raw text and accumulate token metrics.
export function parseTranscriptUsage(
  input:
    string | readonly TranscriptTurn[] | TranscriptPayload | SessionTokenUsage,
  defaultSession?: string,
): SessionTokenUsage {
  if (typeof input === "object" && input !== null) {
    if (Array.isArray(input)) {
      let totalTokens = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const turn of input) {
        if (typeof turn.totalTokens === "number") {
          totalTokens += turn.totalTokens;
        } else if (typeof turn.tokens === "number") {
          totalTokens += turn.tokens;
        } else if (
          typeof turn.inputTokens === "number" ||
          typeof turn.outputTokens === "number"
        ) {
          const inT = turn.inputTokens ?? 0;
          const outT = turn.outputTokens ?? 0;
          inputTokens += inT;
          outputTokens += outT;
          totalTokens += inT + outT;
        } else {
          const text =
            turn.content ?? turn.text ?? turn.thinking ?? JSON.stringify(turn);
          totalTokens += estimateTokens(text);
        }
      }
      return {
        session: defaultSession,
        turns: input.length,
        totalTokens,
        ...(inputTokens > 0 ? { inputTokens } : {}),
        ...(outputTokens > 0 ? { outputTokens } : {}),
      };
    }

    const payload = input as TranscriptPayload;
    const session = payload.session ?? payload.sessionId ?? defaultSession;

    if (
      typeof payload.totalTokens === "number" &&
      !Array.isArray(payload.turns)
    ) {
      const turns =
        typeof (input as SessionTokenUsage).turns === "number"
          ? (input as SessionTokenUsage).turns
          : 1;
      return {
        session,
        turns,
        totalTokens: payload.totalTokens,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
      };
    }

    if (Array.isArray(payload.turns)) {
      const parsed = parseTranscriptUsage(payload.turns, session);
      return {
        ...parsed,
        session,
        ...(typeof payload.totalTokens === "number"
          ? { totalTokens: payload.totalTokens }
          : {}),
      };
    }
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { session: defaultSession, turns: 0, totalTokens: 0 };
    }

    try {
      const parsedJson = JSON.parse(trimmed);
      if (Array.isArray(parsedJson)) {
        return parseTranscriptUsage(parsedJson, defaultSession);
      }
      if (typeof parsedJson === "object" && parsedJson !== null) {
        return parseTranscriptUsage(
          parsedJson as TranscriptPayload,
          defaultSession,
        );
      }
    } catch {
      // Input is not single JSON payload; proceed to JSONL or text parsing.
    }

    const lines = trimmed.split("\n");
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let parsedCount = 0;

    for (const line of lines) {
      const lineTrim = line.trim();
      if (!lineTrim) continue;
      try {
        const item = JSON.parse(lineTrim);
        parsedCount++;
        if (typeof item.totalTokens === "number") {
          totalTokens += item.totalTokens;
        } else if (typeof item.tokens === "number") {
          totalTokens += item.tokens;
        } else if (
          typeof item.input_tokens === "number" ||
          typeof item.output_tokens === "number"
        ) {
          const inT = item.input_tokens ?? 0;
          const outT = item.output_tokens ?? 0;
          inputTokens += inT;
          outputTokens += outT;
          totalTokens += inT + outT;
        } else if (
          typeof item.inputTokens === "number" ||
          typeof item.outputTokens === "number"
        ) {
          const inT = item.inputTokens ?? 0;
          const outT = item.outputTokens ?? 0;
          inputTokens += inT;
          outputTokens += outT;
          totalTokens += inT + outT;
        } else {
          const body =
            typeof item.content === "string"
              ? item.content
              : typeof item.text === "string"
                ? item.text
                : lineTrim;
          totalTokens += estimateTokens(body);
        }
      } catch {
        // Line is non-JSON text.
      }
    }

    if (parsedCount > 0) {
      return {
        session: defaultSession,
        turns: parsedCount,
        totalTokens,
        ...(inputTokens > 0 ? { inputTokens } : {}),
        ...(outputTokens > 0 ? { outputTokens } : {}),
      };
    }

    return {
      session: defaultSession,
      turns: lines.length,
      totalTokens: estimateTokens(input),
    };
  }

  return {
    session: defaultSession,
    turns: 0,
    totalTokens: 0,
  };
}

// Generate actionable advisory nudging transcript compaction when thresholds are crossed.
export function generateCompactNudge(
  usageOrTokens: number | SessionTokenUsage,
  thresholds: TokenThresholds,
  session?: string,
): CompactNudgeAdvisory {
  const currentTokens =
    typeof usageOrTokens === "number"
      ? usageOrTokens
      : usageOrTokens.totalTokens;
  const sessionName =
    typeof usageOrTokens === "object" && usageOrTokens.session
      ? usageOrTokens.session
      : session;
  const resolved = resolveThresholds(thresholds);
  const prefix = sessionName ? `Session "${sessionName}"` : "Context";

  if (resolved.block_at !== undefined && currentTokens >= resolved.block_at) {
    const tokensOverCompact =
      resolved.compact_at !== undefined
        ? Math.max(0, currentTokens - resolved.compact_at)
        : currentTokens - resolved.block_at;
    return {
      needed: true,
      severity: "critical",
      message: `${prefix} reached ${currentTokens} tokens, exceeding block threshold (${resolved.block_at}). Compaction required immediately.`,
      suggestedAction: "/compact",
      currentTokens,
      compactAt: resolved.compact_at,
      blockAt: resolved.block_at,
      tokensOverCompact,
      headroomUntilBlock: resolved.block_at - currentTokens,
    };
  }

  if (
    resolved.compact_at !== undefined &&
    currentTokens >= resolved.compact_at
  ) {
    const tokensOverCompact = currentTokens - resolved.compact_at;
    const headroomUntilBlock =
      resolved.block_at !== undefined
        ? resolved.block_at - currentTokens
        : undefined;
    return {
      needed: true,
      severity: "warning",
      message: `${prefix} reached ${currentTokens} tokens, exceeding compact threshold (${resolved.compact_at}). Run /compact to summarize context before blocking limit.`,
      suggestedAction: "/compact",
      currentTokens,
      compactAt: resolved.compact_at,
      blockAt: resolved.block_at,
      tokensOverCompact,
      headroomUntilBlock,
    };
  }

  const approachingWarn =
    resolved.warn_at !== undefined && currentTokens >= resolved.warn_at;
  const message = approachingWarn
    ? `${prefix} reached ${currentTokens} tokens (warn threshold ${resolved.warn_at}). Approaching compact boundary.`
    : "Context usage is within healthy threshold limits.";

  return {
    needed: false,
    severity: "info",
    message,
    suggestedAction: "none",
    currentTokens,
    compactAt: resolved.compact_at,
    blockAt: resolved.block_at,
    tokensOverCompact: 0,
    headroomUntilBlock:
      resolved.block_at !== undefined
        ? resolved.block_at - currentTokens
        : undefined,
  };
}

// Evaluate token usage against warning, compacting, and blocking boundaries.
export function auditSessionTokens(
  input:
    | number
    | SessionTokenUsage
    | readonly TranscriptTurn[]
    | TranscriptPayload
    | string,
  thresholds: TokenThresholds,
  session?: string,
): SessionAuditReport {
  const usage =
    typeof input === "number"
      ? { session, turns: 1, totalTokens: input }
      : parseTranscriptUsage(input, session);

  const resolved = resolveThresholds(thresholds);
  const breached: ("warn_at" | "compact_at" | "block_at")[] = [];

  if (resolved.warn_at !== undefined && usage.totalTokens >= resolved.warn_at) {
    breached.push("warn_at");
  }
  if (
    resolved.compact_at !== undefined &&
    usage.totalTokens >= resolved.compact_at
  ) {
    breached.push("compact_at");
  }
  if (
    resolved.block_at !== undefined &&
    usage.totalTokens >= resolved.block_at
  ) {
    breached.push("block_at");
  }

  const status: TokenAuditStatus =
    resolved.block_at !== undefined && usage.totalTokens >= resolved.block_at
      ? "block"
      : resolved.compact_at !== undefined &&
          usage.totalTokens >= resolved.compact_at
        ? "compact"
        : resolved.warn_at !== undefined &&
            usage.totalTokens >= resolved.warn_at
          ? "warn"
          : "ok";

  const headroom: TokenHeadroom = {
    untilWarn:
      resolved.warn_at !== undefined
        ? resolved.warn_at - usage.totalTokens
        : undefined,
    untilCompact:
      resolved.compact_at !== undefined
        ? resolved.compact_at - usage.totalTokens
        : undefined,
    untilBlock:
      resolved.block_at !== undefined
        ? resolved.block_at - usage.totalTokens
        : undefined,
  };

  const advisory = generateCompactNudge(usage, resolved, session);

  return {
    session: usage.session,
    status,
    totalTokens: usage.totalTokens,
    turns: usage.turns,
    thresholds: resolved,
    breached,
    headroom,
    advisory,
    usage,
  };
}

// Aggregate audits across multiple sessions to surface fleet status and compacting alerts.
export function auditSessionBatch(
  sessions: readonly (
    | SessionTokenUsage
    | {
        session?: string;
        transcript?: string | readonly TranscriptTurn[];
        totalTokens?: number;
      }
  )[],
  thresholds: TokenThresholds,
): SessionBatchAuditReport {
  const summaries: SessionAuditReport[] = [];
  const advisories: CompactNudgeAdvisory[] = [];
  let totalTokens = 0;
  let warnCount = 0;
  let compactCount = 0;
  let blockCount = 0;

  for (const item of sessions) {
    const report =
      "transcript" in item && item.transcript !== undefined
        ? auditSessionTokens(item.transcript, thresholds, item.session)
        : auditSessionTokens(
            item as SessionTokenUsage,
            thresholds,
            item.session,
          );

    summaries.push(report);
    totalTokens += report.totalTokens;

    if (report.advisory.needed) {
      advisories.push(report.advisory);
    }

    if (report.breached.includes("block_at")) blockCount++;
    else if (report.breached.includes("compact_at")) compactCount++;
    else if (report.breached.includes("warn_at")) warnCount++;
  }

  const statusOrder: Record<TokenAuditStatus, number> = {
    block: 3,
    compact: 2,
    warn: 1,
    ok: 0,
  };

  let worstStatus: TokenAuditStatus = "ok";
  for (const report of summaries) {
    if (statusOrder[report.status] > statusOrder[worstStatus]) {
      worstStatus = report.status;
    }
  }

  return {
    totalSessions: sessions.length,
    status: worstStatus,
    totalTokens,
    summaries,
    advisories,
    breachedCount: {
      warn: warnCount,
      compact: compactCount,
      block: blockCount,
    },
  };
}

// Render human-readable compact nudge message suitable for terminal prompts.
export function formatCompactNudge(advisory: CompactNudgeAdvisory): string {
  if (!advisory.needed) {
    return `[budget:ok] ${advisory.message}`;
  }
  const tag =
    advisory.severity === "critical" ? "budget:block" : "budget:compact";
  const over =
    advisory.tokensOverCompact !== undefined
      ? ` (+${advisory.tokensOverCompact} tokens over)`
      : "";
  return `[${tag}] ${advisory.message}${over} Action: ${advisory.suggestedAction}`;
}

// Render structured summary string of a session audit report.
export function formatAuditReport(report: SessionAuditReport): string {
  const lines: string[] = [
    `Session: ${report.session ?? "unnamed"}`,
    `Status: ${report.status.toUpperCase()}`,
    `Tokens: ${report.totalTokens} across ${report.turns} turn(s)`,
  ];
  if (report.breached.length > 0) {
    lines.push(`Breached thresholds: ${report.breached.join(", ")}`);
  }
  if (report.advisory.needed) {
    lines.push(`Advisory: ${report.advisory.message}`);
    lines.push(`Suggested Action: ${report.advisory.suggestedAction}`);
  }
  return lines.join("\n");
}
