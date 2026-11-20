import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditPromptBudget, estimateTokens } from "../src/budgets/tokens.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-budget-tokens-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("prompt token budget audit", () => {
  it("estimates tokens conservatively and flags thresholds", () => {
    const dir = tempDir();
    const agents = join(dir, "AGENTS.md");
    const pkg = join(dir, "PACKAGE.md");
    writeFileSync(agents, "a".repeat(4000));
    writeFileSync(pkg, "b".repeat(800));

    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);

    const report = auditPromptBudget([agents, pkg], {
      maxTokens: 1000,
      warnTokens: 500,
    });
    expect(report.totalTokens).toBe(1200);
    expect(report.status).toBe("exceeded");
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0]?.path).toBe(agents);

    const okReport = auditPromptBudget([pkg], {
      maxTokens: 1000,
      warnTokens: 500,
    });
    expect(okReport.status).toBe("ok");
  });
});
