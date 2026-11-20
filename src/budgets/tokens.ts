import { readFileSync } from "node:fs";

export * from "./audit.js";

export interface TokenBudgetLimits {
  readonly maxTokens: number;
  readonly warnTokens?: number;
}

export interface TokenBudgetEntry {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
  readonly estTokens: number;
}

export interface TokenBudgetReport {
  readonly status: "ok" | "warn" | "exceeded";
  readonly totalBytes: number;
  readonly totalTokens: number;
  readonly limits: TokenBudgetLimits;
  readonly entries: TokenBudgetEntry[];
}

// Conservative 4-byte-per-token estimate matching crates/pmcp-index.
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

export function auditPromptBudget(
  paths: readonly string[],
  limits: TokenBudgetLimits,
): TokenBudgetReport {
  const entries: TokenBudgetEntry[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const bytes = Buffer.byteLength(text, "utf8");
    const lines = text.length === 0 ? 0 : text.split("\n").length;
    entries.push({ path, bytes, lines, estTokens: estimateTokens(text) });
  }
  entries.sort((a, b) => b.estTokens - a.estTokens);
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  const totalTokens = entries.reduce((sum, e) => sum + e.estTokens, 0);
  const status =
    totalTokens > limits.maxTokens
      ? "exceeded"
      : limits.warnTokens !== undefined && totalTokens > limits.warnTokens
        ? "warn"
        : "ok";
  return { status, totalBytes, totalTokens, limits, entries };
}
