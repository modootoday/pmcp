import { describe, expect, it } from "vitest";

import { inferSession } from "../../src/sessions/identity.js";
import type { LiveRecord } from "../../src/sessions/types.js";

const record = (session: string, pid: number, runtime: string): LiveRecord => ({
  session,
  pid,
  runtime,
  live: true,
});

describe("the session a CLI command runs inside", () => {
  it("prefers the session whose runtime process is the nearest ancestor", () => {
    // A Codex session started from a Claude session sees both ids (measured live).
    const env = {
      CLAUDE_CODE_SESSION_ID: "claude-outer-0001",
      CODEX_THREAD_ID: "codex-inner-0002",
    };
    const records = [
      record("claude-outer-0001", 100, "claude"),
      record("gemini-0003", 300, "gemini"),
    ];
    expect(inferSession(env, records, [500, 300, 100])).toEqual({
      session: "gemini-0003",
      runtime: "gemini",
      via: "process",
    });
  });

  it("falls back to the innermost runtime's variable", () => {
    const env = {
      CLAUDE_CODE_SESSION_ID: "claude-outer-0001",
      CODEX_THREAD_ID: "codex-inner-0002",
    };
    expect(inferSession(env, [], [500])).toEqual({
      session: "codex-inner-0002",
      runtime: "codex",
      via: "environment",
    });
    expect(inferSession({ GROK_SESSION_ID: "g-1" }, [], []).session).toBe(
      "g-1",
    );
    expect(
      inferSession({ ANTIGRAVITY_CONVERSATION_ID: "a-1" }, [], []).session,
    ).toBe("a-1");
  });

  it("names the runtime without a session where it exposes none, and nothing outside one", () => {
    expect(inferSession({ GEMINI_CLI: "1" }, [], [])).toEqual({
      runtime: "gemini",
    });
    expect(inferSession({ OPENCODE: "1" }, [], [])).toEqual({
      runtime: "opencode",
    });
    expect(inferSession({}, [], [])).toEqual({});
  });

  it("ignores stale records", () => {
    const stale = { ...record("old-0001", 300, "codex"), live: false };
    expect(inferSession({}, [stale], [300])).toEqual({});
  });
});
