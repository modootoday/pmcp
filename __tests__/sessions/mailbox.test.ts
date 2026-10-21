import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readMailbox } from "../../src/sessions/settings.js";
import { MAILBOX_ON, scratchStore } from "../hooks/helpers.js";

const operator = { key: "@operator", alias: "operator" };
const session = (id: string, more: Record<string, unknown> = {}) => ({
  key: id,
  session: id,
  ...more,
});

describe("mailbox store", () => {
  it("is off without a [sessions.mailbox] table and refuses unknown keys", () => {
    expect(readMailbox(undefined).enabled).toBe(false);
    expect(readMailbox({}).enabled).toBe(true);
    expect(readMailbox({ ttl_minutes: 5 }).ttlMinutes).toBe(5);
    expect(() => readMailbox({ keep: 3 })).toThrow(
      "[sessions.mailbox] unknown key keep",
    );
  });

  it("writes one file per message and never rewrites it; acks are per recipient", () => {
    const store = scratchStore({ mailbox: MAILBOX_ON });
    const message = store.mailbox.send({
      from: { alias: "operator" },
      to: ["all"],
      body: "rebase before noon",
    });
    const file = join(store.dir, "messages", `${message.id}.json`);
    const before = readFileSync(file, "utf8");
    const a = session("aaaaaaaa-1111");
    const b = session("bbbbbbbb-2222");
    expect(store.mailbox.inbox(a).map((m) => m.id)).toEqual([message.id]);
    expect(store.mailbox.ack(a.key, [message.id])).toEqual([message.id]);
    expect(store.mailbox.inbox(a)).toEqual([]);
    expect(store.mailbox.inbox(b).map((m) => m.id)).toEqual([message.id]);
    expect(
      existsSync(join(store.dir, "inbox", a.key, `${message.id}.ack`)),
    ).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(before);
    // The sender does not receive its own message.
    expect(store.mailbox.inbox(operator)).toEqual([]);
  });

  it("records delivery separately and never as an acknowledgement", () => {
    const store = scratchStore({ mailbox: MAILBOX_ON });
    const { id } = store.mailbox.send({ from: {}, to: ["all"], body: "x" });
    const a = session("aaaaaaaa-1111");
    store.mailbox.markDelivered(a.key, [id]);
    expect(store.mailbox.delivered(a.key, id)).toBe(true);
    expect(store.mailbox.acked(a.key, id)).toBe(false);
    expect(store.mailbox.inbox(a).map((m) => m.id)).toEqual([id]);
  });

  it("expires messages and sweeps them with their markers", () => {
    const store = scratchStore({ mailbox: MAILBOX_ON });
    const short = store.mailbox.send({
      from: {},
      to: ["all"],
      body: "short",
      ttlMinutes: 1,
    });
    const long = store.mailbox.send({ from: {}, to: ["all"], body: "long" });
    store.mailbox.ack("aaaaaaaa-1111", [short.id]);
    const later = Date.now() + 2 * 60_000;
    expect(store.mailbox.list(later).map((m) => m.id)).toEqual([long.id]);
    expect(store.mailbox.sweep(later)).toBe(1);
    expect(readdirSync(join(store.dir, "messages"))).toEqual([
      `${long.id}.json`,
    ]);
    expect(
      existsSync(join(store.dir, "inbox", "aaaaaaaa-1111", `${short.id}.ack`)),
    ).toBe(false);
    const audit = readFileSync(join(store.dir, "messages.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).event);
    expect(audit).toEqual(["sent", "sent", "acked", "expired"]);
  });

  it("resolves session, alias, role and desk selectors", () => {
    const store = scratchStore({ mailbox: MAILBOX_ON });
    const send = (to: string) =>
      store.mailbox.send({ from: {}, to: [to], body: to }).id;
    const ids = {
      session: send("session:aaaaaaaa"),
      alias: send("alias:reviewer-desk"),
      role: send("role:reviewer"),
      desk: send("desk:/w/.claude/worktrees/feature"),
      deskName: send("desk:feature"),
    };
    const a = session("aaaaaaaa-1111", {
      alias: "reviewer-desk",
      roles: ["reviewer"],
      desk: "/w/.claude/worktrees/feature",
    });
    expect(
      store.mailbox
        .inbox(a)
        .map((m) => m.id)
        .sort(),
    ).toEqual(Object.values(ids).sort());
    const other = session("cccccccc-3333", {
      alias: "x",
      roles: ["writer"],
      desk: "/w",
    });
    expect(store.mailbox.inbox(other)).toEqual([]);
  });

  it("keeps broadcast.json for its readers and carries the broadcast as a message to all", () => {
    const store = scratchStore({ mailbox: MAILBOX_ON });
    const posted = store.broadcast.post({ by: "operator", text: "freeze" });
    expect(store.broadcast.list().at(-1)?.id).toBe(posted.id);
    const [message] = store.mailbox.list();
    expect(message).toMatchObject({
      to: ["all"],
      body: "freeze",
      broadcastId: posted.id,
    });
    store.broadcast.clear();
    expect(store.broadcast.list()).toEqual([]);
    expect(store.mailbox.list()).toEqual([]);
  });

  it("leaves broadcasts alone when the mailbox is off", () => {
    const store = scratchStore();
    store.broadcast.post({ by: "operator", text: "freeze" });
    expect(store.mailbox.list()).toEqual([]);
  });
});
