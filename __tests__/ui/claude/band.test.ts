import { describe, expect, it } from "vitest";

import { bandMark } from "../../../src/ui/claude/model.js";

const snapshot = (statuses: readonly string[]) => ({
  records: statuses.map((status, index) => ({
    session: `s${index}`,
    status: status as "idle" | "working" | "waiting",
  })),
  pause: null,
  lease: null,
  broadcast: null,
});

describe("the band's spinner follows the sessions' working state", () => {
  it("shows a static mark when every session is idle", () => {
    expect(bandMark(snapshot(["idle", "idle"]))).toEqual({
      spin: false,
      glyph: "○",
    });
    expect(bandMark(snapshot([]))).toEqual({ spin: false, glyph: "○" });
  });

  it("spins while any session is working", () => {
    expect(bandMark(snapshot(["idle", "working"]))).toEqual({
      spin: true,
      glyph: "●",
    });
  });

  it("does not spin for a session that only waits at its prompt", () => {
    const done = snapshot(["waiting"]);
    const record = { ...done.records[0]!, waiting: "idle_prompt" };
    expect(bandMark({ ...done, records: [record] }).spin).toBe(false);
  });
});
