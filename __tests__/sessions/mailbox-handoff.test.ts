import { describe, expect, it } from "vitest";
import {
  formatHandoff,
  parseHandoff,
  type HandoffReceipt,
  type HandoffTask,
} from "../../src/sessions/mailbox/handoff.js";

describe("mailbox structured handoff", () => {
  it("round-trips a handoff task and receipt", () => {
    const task: HandoffTask = {
      kind: "handoff-task",
      id: "task-p2-2",
      title: "Implement hook cache",
      paths: ["packages/pmcp/src/hooks/policies/external.ts"],
      verification: ["bun --cwd packages/pmcp run test"],
      owner: "worker-claude",
    };
    const encoded = formatHandoff(task);
    expect(parseHandoff(encoded)).toEqual(task);

    const receipt: HandoffReceipt = {
      kind: "handoff-receipt",
      taskId: "task-p2-2",
      status: "done",
      commits: ["abc1234"],
      verified: ["vitest 100% pass"],
    };
    expect(parseHandoff(formatHandoff(receipt))).toEqual(receipt);
  });

  it("returns null for plain text or malformed handoff messages", () => {
    expect(parseHandoff("just a plain coordination note")).toBeNull();
    expect(parseHandoff("pmcp-handoff/v1 {bad json")).toBeNull();
    expect(parseHandoff('pmcp-handoff/v1 {"kind":"unknown"}')).toBeNull();
  });
});
