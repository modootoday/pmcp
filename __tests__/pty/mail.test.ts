import { describe, expect, it } from "vitest";

import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import { addressedTo } from "../../src/sessions/mailbox/select.js";
import type { Message } from "../../src/sessions/types.js";
import {
  MAILBOX_ON,
  compiled,
  decide,
  fixture,
  guard,
  scratchStore,
} from "../hooks/helpers.js";

function message(to: string[], createdAt: string): Message {
  return {
    id: "1-a",
    from: { alias: "lead" },
    to,
    body: "hi",
    createdAt,
    expiresAt: "2999-01-01T00:00:00.000Z",
    once: false,
  };
}

describe("broadcasts and the sessions that existed when they were sent", () => {
  const recipient = {
    key: "s-1",
    session: "s-1",
    since: "2026-10-20T10:00:00.000Z",
  };

  it("does not give a later session an earlier broadcast, but keeps mail addressed to it", () => {
    expect(
      addressedTo(message(["all"], "2026-10-20T09:59:59.000Z"), recipient),
    ).toBe(false);
    expect(
      addressedTo(message(["all"], "2026-10-20T10:00:01.000Z"), recipient),
    ).toBe(true);
    const direct = message(["session:s-1"], "2026-10-20T09:00:00.000Z");
    expect(addressedTo(direct, recipient)).toBe(true);
    const both = message(["all", "session:s-1"], "2026-10-20T09:00:00.000Z");
    expect(addressedTo(both, recipient)).toBe(true);
    const { since: _, ...operator } = recipient;
    expect(
      addressedTo(message(["all"], "2000-01-01T00:00:00.000Z"), operator),
    ).toBe(true);
  });
});

describe("mail for a session hosted by pmcp-pty", () => {
  const policy = compiled([guard("sessions.mailbox", "warn", { roles: {} })], {
    targets: ["claude"],
  });
  const session = "claude-hosted-0002";
  const prompt = (text: string) => {
    const payload = {
      ...fixture("claude", "UserPromptSubmit"),
      session_id: session,
      prompt: text,
    };
    return RUNTIMES.claude.normalize("UserPromptSubmit", payload, "/w")!;
  };

  function store(hosted: boolean) {
    const s = scratchStore({ mailbox: MAILBOX_ON });
    const pty = {
      socket: "/nonexistent/pty.sock",
      session: "s3",
      instance: "1-1",
    };
    s.registry.upsert(session, {
      runtime: "claude",
      pid: process.pid,
      ...(hosted ? { pty } : {}),
    });
    s.mailbox.send({
      from: { alias: "lead" },
      to: [`session:${session}`],
      subject: "deploy",
      body: "hold",
    });
    return s;
  }

  it("arrives only on the wake turn, never as context on another prompt", async () => {
    const hosted = store(true);
    const other = await decide(prompt("Reply with exactly PTY-OK"), policy, {
      store: hosted,
    });
    expect(other.context ?? []).toEqual([]);
    const wake = await decide(
      prompt("pmcp mail: 1 new message(s) for you (deploy). Run exactly …"),
      policy,
      { store: hosted },
    );
    expect(wake.context?.join("\n")).toContain("(deploy): hold");
  });

  it("skips a broadcast sent before the session's record began and delivers a later one", async () => {
    const s = scratchStore({ mailbox: MAILBOX_ON });
    s.mailbox.send({
      from: { alias: "lead" },
      to: ["all"],
      subject: "old",
      body: "stale",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    s.registry.upsert(session, { runtime: "claude", pid: process.pid });
    const first = await decide(prompt("hello"), policy, { store: s });
    expect(first.context ?? []).toEqual([]);
    s.mailbox.send({
      from: { alias: "lead" },
      to: ["all"],
      subject: "new",
      body: "fresh",
    });
    const next = await decide(prompt("again"), policy, { store: s });
    expect(next.context?.join("\n")).toContain("(new): fresh");
  });

  it("still arrives on any prompt for a session pmcp-pty does not host", async () => {
    const plain = await decide(prompt("Reply with exactly PTY-OK"), policy, {
      store: store(false),
    });
    expect(plain.context?.join("\n")).toContain("(deploy): hold");
  });
});
