import { createServer as createHttpServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createUdsServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { frames } from "../../src/sessions/wake/claude.js";
import { wakeRecipients, wakeText } from "../../src/sessions/wake/index.js";
import { MAILBOX_ON, scratchStore } from "../hooks/helpers.js";

function home(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-wake-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude/sessions"), { recursive: true });
  return dir;
}

// A stand-in Claude inbox: records every line written to it.
function inbox(t: TestContext, socket: string) {
  const lines: string[] = [];
  const server = createUdsServer((connection) => {
    let text = "";
    connection.on("data", (part) => (text += part));
    connection.on("end", () => lines.push(...text.split("\n").filter(Boolean)));
  });
  t.onTestFinished(() => void server.close());
  return new Promise<string[]>((resolve) =>
    server.listen(socket, () => resolve(lines)),
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("waking a Claude session through its inbox socket", () => {
  it("posts one user frame from pmcp with the inbox command, and records the wake", async (t) => {
    const dir = home(t);
    const socket = join(dir, "inbox.sock");
    const lines = await inbox(t, socket);
    const session = "aaaaaaaa-claude-0001";
    writeFileSync(
      join(dir, ".claude/sessions", `${process.pid}.json`),
      JSON.stringify({
        pid: process.pid,
        sessionId: session,
        messagingSocketPath: socket,
        status: "idle",
      }),
    );
    const before = readdirSync(join(dir, ".claude/sessions")).map((name) => [
      name,
      statSync(join(dir, ".claude/sessions", name)).mtimeMs,
    ]);
    const store = scratchStore({ mailbox: MAILBOX_ON });
    store.registry.upsert(session, { runtime: "claude", pid: process.pid });
    const message = store.mailbox.send({
      from: { alias: "lead" },
      to: ["all"],
      subject: "deploy",
      body: "hold",
    });
    const [result] = await wakeRecipients(store, message, {
      home: dir,
      env: {},
    });
    await settle();
    expect(result).toMatchObject({
      session,
      runtime: "claude",
      outcome: "woken",
      transport: "claude-inbox",
    });
    expect(lines).toHaveLength(1);
    const frame = JSON.parse(lines[0]!);
    expect(frame).toMatchObject({
      type: "user",
      from: "pmcp",
      message: { role: "user" },
    });
    expect(frame.msg_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(frame.message.content).toBe(wakeText(session, [message]));
    expect(frame.message.content).toContain(
      `pmcp sessions inbox --session ${session}`,
    );
    expect(frame.message.content).toContain("(deploy)");
    // pmcp reads ~/.claude/sessions and never writes it.
    const after = readdirSync(join(dir, ".claude/sessions")).map((name) => [
      name,
      statSync(join(dir, ".claude/sessions", name)).mtimeMs,
    ]);
    expect(after).toEqual(before);
    const audit = readFileSync(join(store.dir, "messages.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(audit.at(-1)).toMatchObject({
      event: "woken",
      id: message.id,
      outcome: "woken",
      transport: "claude-inbox",
    });
  });

  it("sends the auth line only to the caller's own socket", () => {
    const env = {
      CLAUDE_CODE_MESSAGING_TOKEN: "tok",
      CLAUDE_CODE_MESSAGING_SOCKET: "/own.sock",
    };
    const own = frames("hi", "/own.sock", env).trim().split("\n");
    expect(JSON.parse(own[0]!)).toEqual({ type: "auth", token: "tok" });
    expect(own).toHaveLength(2);
    expect(frames("hi", "/other.sock", env).trim().split("\n")).toHaveLength(1);
  });

  it("falls back when no live session file names a socket", async (t) => {
    const dir = home(t);
    const store = scratchStore({ mailbox: MAILBOX_ON });
    store.registry.upsert("bbbbbbbb-claude-0002", {
      runtime: "claude",
      pid: process.pid,
    });
    const message = store.mailbox.send({ from: {}, to: ["all"], body: "x" });
    const [result] = await wakeRecipients(store, message, {
      home: dir,
      env: {},
    });
    expect(result).toMatchObject({ outcome: "not-wakeable" });
  });
});

describe("waking an opencode session through its server", () => {
  it("calls prompt_async with basic auth at the recorded server URL", async (t) => {
    const calls: { url?: string; auth?: string; body: string }[] = [];
    const server = createHttpServer((request, response) => {
      let body = "";
      request.on("data", (part) => (body += part));
      request.on("end", () => {
        calls.push({
          url: request.url,
          auth: request.headers.authorization,
          body,
        });
        response.statusCode = 204;
        response.end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.onTestFinished(() => void server.close());
    const port = (server.address() as { port: number }).port;
    const store = scratchStore({ mailbox: MAILBOX_ON });
    store.registry.upsert("ses_opencode0001", {
      runtime: "opencode",
      pid: process.pid,
      wakeUrl: `http://127.0.0.1:${port}/`,
    });
    const message = store.mailbox.send({ from: {}, to: ["all"], body: "x" });
    const env = { OPENCODE_SERVER_PASSWORD: "pw" };
    const [result] = await wakeRecipients(store, message, {
      home: "/nonexistent",
      env,
    });
    expect(result).toMatchObject({
      outcome: "woken",
      transport: "opencode-server",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/session/ses_opencode0001/prompt_async");
    expect(calls[0]!.auth).toBe(
      `Basic ${Buffer.from("opencode:pw").toString("base64")}`,
    );
    expect(JSON.parse(calls[0]!.body)).toEqual({
      parts: [{ type: "text", text: wakeText("ses_opencode0001", [message]) }],
    });
  });

  it("reports not wakeable when the server is gone, and when no URL was recorded", async () => {
    const store = scratchStore({ mailbox: MAILBOX_ON });
    store.registry.upsert("ses_gone00000001", {
      runtime: "opencode",
      pid: process.pid,
      wakeUrl: "http://127.0.0.1:9/",
    });
    store.registry.upsert("ses_nourl0000001", {
      runtime: "opencode",
      pid: process.pid,
    });
    const message = store.mailbox.send({ from: {}, to: ["all"], body: "x" });
    const results = await wakeRecipients(store, message, {
      home: "/nonexistent",
      env: {},
    });
    expect(results.map((result) => result.outcome)).toEqual([
      "not-wakeable",
      "not-wakeable",
    ]);
  });
});

describe("runtimes without a wake transport", () => {
  it.each(["codex", "gemini", "antigravity", "grok"])(
    "%s keeps next-event delivery",
    async (runtime) => {
      const store = scratchStore({ mailbox: MAILBOX_ON });
      store.registry.upsert(`${runtime}-session-0001`, {
        runtime,
        pid: process.pid,
      });
      const message = store.mailbox.send({ from: {}, to: ["all"], body: "x" });
      const [result] = await wakeRecipients(store, message, {
        home: "/nonexistent",
        env: {},
      });
      expect(result).toMatchObject({ runtime, outcome: "not-wakeable" });
      expect(
        store.mailbox.inbox({
          key: `${runtime}-session-0001`,
          session: `${runtime}-session-0001`,
        }),
      ).toHaveLength(1);
    },
  );
});
