import { describe, expect, it } from "vitest";
import {
  auditSessionBatch,
  auditSessionTokens,
  formatAuditReport,
  formatCompactNudge,
  generateCompactNudge,
  parseTranscriptUsage,
  resolveThresholds,
  type TokenThresholds,
  type TranscriptTurn,
} from "../src/budgets/audit.js";

describe("token threshold resolution", () => {
  it("resolves raw token thresholds and handles camelCase aliases", () => {
    const snake = resolveThresholds({
      warn_at: 10000,
      compact_at: 20000,
      block_at: 30000,
    });
    expect(snake.warn_at).toBe(10000);
    expect(snake.compact_at).toBe(20000);
    expect(snake.block_at).toBe(30000);

    const camel = resolveThresholds({
      warnAt: 15000,
      compactAt: 25000,
      blockAt: 35000,
    });
    expect(camel.warn_at).toBe(15000);
    expect(camel.compact_at).toBe(25000);
    expect(camel.block_at).toBe(35000);
  });

  it("resolves fractional thresholds against max_tokens ceiling", () => {
    const resolved = resolveThresholds({
      warn_at: 0.5,
      compact_at: 0.75,
      block_at: 0.9,
      max_tokens: 200000,
    });
    expect(resolved.warn_at).toBe(100000);
    expect(resolved.compact_at).toBe(150000);
    expect(resolved.block_at).toBe(180000);
    expect(resolved.max_tokens).toBe(200000);
  });
});

describe("transcript usage parsing", () => {
  it("computes usage from structured turns with explicit token counts", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", content: "hello", tokens: 10 },
      {
        role: "assistant",
        content: "world",
        inputTokens: 15,
        outputTokens: 25,
      },
      { role: "user", content: "repeat", totalTokens: 50 },
    ];
    const usage = parseTranscriptUsage(turns, "session-alpha");
    expect(usage.session).toBe("session-alpha");
    expect(usage.turns).toBe(3);
    expect(usage.totalTokens).toBe(100);
  });

  it("estimates tokens when turn tokens are not provided", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", content: "a".repeat(400) },
      { role: "assistant", content: "b".repeat(800) },
    ];
    const usage = parseTranscriptUsage(turns);
    expect(usage.turns).toBe(2);
    expect(usage.totalTokens).toBe(300);
  });

  it("parses JSONL formatted transcript string", () => {
    const jsonl = [
      JSON.stringify({ role: "user", content: "prompt", tokens: 50 }),
      JSON.stringify({
        role: "assistant",
        input_tokens: 30,
        output_tokens: 70,
      }),
      JSON.stringify({ role: "system", content: "system note", tokens: 20 }),
    ].join("\n");

    const usage = parseTranscriptUsage(jsonl, "jsonl-session");
    expect(usage.session).toBe("jsonl-session");
    expect(usage.turns).toBe(3);
    expect(usage.totalTokens).toBe(170);
    expect(usage.inputTokens).toBe(30);
    expect(usage.outputTokens).toBe(70);
  });

  it("handles empty or plain text transcript fallback", () => {
    const empty = parseTranscriptUsage("");
    expect(empty.turns).toBe(0);
    expect(empty.totalTokens).toBe(0);

    const plain = parseTranscriptUsage(
      "plain text conversation transcript",
      "plain-sess",
    );
    expect(plain.session).toBe("plain-sess");
    expect(plain.turns).toBe(1);
    expect(plain.totalTokens).toBeGreaterThan(0);
  });
});

describe("compact-nudge advisory generation", () => {
  const thresholds: TokenThresholds = {
    warn_at: 1000,
    compact_at: 2000,
    block_at: 3000,
  };

  it("returns info advisory when usage is healthy", () => {
    const advisory = generateCompactNudge(500, thresholds, "worker-1");
    expect(advisory.needed).toBe(false);
    expect(advisory.severity).toBe("info");
    expect(advisory.suggestedAction).toBe("none");
    expect(advisory.headroomUntilBlock).toBe(2500);
  });

  it("returns warn advisory without compact need between warn_at and compact_at", () => {
    const advisory = generateCompactNudge(1500, thresholds, "worker-1");
    expect(advisory.needed).toBe(false);
    expect(advisory.severity).toBe("info");
    expect(advisory.message).toContain("warn threshold 1000");
  });

  it("triggers compact nudge with warning severity when compact_at is reached", () => {
    const advisory = generateCompactNudge(2200, thresholds, "worker-1");
    expect(advisory.needed).toBe(true);
    expect(advisory.severity).toBe("warning");
    expect(advisory.suggestedAction).toBe("/compact");
    expect(advisory.tokensOverCompact).toBe(200);
    expect(advisory.headroomUntilBlock).toBe(800);
    expect(advisory.message).toContain("exceeding compact threshold");
  });

  it("triggers critical advisory when block_at is reached or exceeded", () => {
    const advisory = generateCompactNudge(3100, thresholds, "worker-1");
    expect(advisory.needed).toBe(true);
    expect(advisory.severity).toBe("critical");
    expect(advisory.suggestedAction).toBe("/compact");
    expect(advisory.headroomUntilBlock).toBe(-100);
    expect(advisory.message).toContain("exceeding block threshold");
  });
});

describe("session token budget auditing", () => {
  const limits: TokenThresholds = {
    warn_at: 500,
    compact_at: 1000,
    block_at: 1500,
  };

  it("evaluates statuses across all threshold tiers", () => {
    const ok = auditSessionTokens(300, limits);
    expect(ok.status).toBe("ok");
    expect(ok.breached).toHaveLength(0);
    expect(ok.headroom.untilWarn).toBe(200);

    const warn = auditSessionTokens(600, limits);
    expect(warn.status).toBe("warn");
    expect(warn.breached).toEqual(["warn_at"]);
    expect(warn.headroom.untilWarn).toBe(-100);
    expect(warn.headroom.untilCompact).toBe(400);

    const compact = auditSessionTokens(1100, limits);
    expect(compact.status).toBe("compact");
    expect(compact.breached).toEqual(["warn_at", "compact_at"]);
    expect(compact.advisory.needed).toBe(true);

    const block = auditSessionTokens(1600, limits);
    expect(block.status).toBe("block");
    expect(block.breached).toEqual(["warn_at", "compact_at", "block_at"]);
    expect(block.advisory.severity).toBe("critical");
  });

  it("audits sessions directly from transcript turn inputs", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", content: "task 1", tokens: 600 },
      { role: "assistant", content: "response 1", tokens: 600 },
    ];
    const report = auditSessionTokens(turns, limits, "transcript-test");
    expect(report.session).toBe("transcript-test");
    expect(report.turns).toBe(2);
    expect(report.totalTokens).toBe(1200);
    expect(report.status).toBe("compact");
    expect(report.advisory.needed).toBe(true);
  });
});

describe("batch session token auditing", () => {
  it("aggregates multiple session audits and assigns worst status", () => {
    const sessions = [
      { session: "s1", totalTokens: 200, turns: 1 },
      { session: "s2", totalTokens: 600, turns: 2 },
      { session: "s3", totalTokens: 1200, turns: 4 },
    ];
    const thresholds: TokenThresholds = {
      warn_at: 500,
      compact_at: 1000,
      block_at: 2000,
    };

    const batch = auditSessionBatch(sessions, thresholds);
    expect(batch.totalSessions).toBe(3);
    expect(batch.status).toBe("compact");
    expect(batch.totalTokens).toBe(2000);
    expect(batch.breachedCount.warn).toBe(1);
    expect(batch.breachedCount.compact).toBe(1);
    expect(batch.breachedCount.block).toBe(0);
    expect(batch.advisories).toHaveLength(1);
    expect(batch.advisories[0]?.needed).toBe(true);
  });
});

describe("formatting helpers", () => {
  it("formats compact nudge advisories into terminal tag strings", () => {
    const normal = generateCompactNudge(100, { compact_at: 500 });
    expect(formatCompactNudge(normal)).toContain("[budget:ok]");

    const compact = generateCompactNudge(600, {
      compact_at: 500,
      block_at: 1000,
    });
    expect(formatCompactNudge(compact)).toContain("[budget:compact]");
    expect(formatCompactNudge(compact)).toContain("Action: /compact");

    const block = generateCompactNudge(1200, {
      compact_at: 500,
      block_at: 1000,
    });
    expect(formatCompactNudge(block)).toContain("[budget:block]");
  });

  it("formats structured multi-line report", () => {
    const report = auditSessionTokens(
      1200,
      {
        warn_at: 500,
        compact_at: 1000,
        block_at: 1500,
      },
      "sess-xyz",
    );

    const formatted = formatAuditReport(report);
    expect(formatted).toContain("Session: sess-xyz");
    expect(formatted).toContain("Status: COMPACT");
    expect(formatted).toContain("Breached thresholds: warn_at, compact_at");
    expect(formatted).toContain("Suggested Action: /compact");
  });
});
