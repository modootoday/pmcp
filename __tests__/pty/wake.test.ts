import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { wakeRecipients, wakeText } from "../../src/sessions/wake/index.js";
import { lastWakes } from "../../src/sessions/wake/last.js";
import { wakeableBy } from "../../src/sessions/wake/probe.js";
import { ptyFields } from "../../src/sessions/wake/pty-ref.js";
import { MAILBOX_ON, scratchStore } from "../hooks/helpers.js";

type Reply = Record<string, unknown>;

// A stand-in pmcp-pty host: records each request line and answers with the given reply.
function host(t: TestContext, reply: Reply) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-pty-host-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const socket = join(dir, "pty.sock");
  const requests: Reply[] = [];
  const server = createServer((connection) => {
    let text = "";
    connection.on("data", (part) => {
      text += part.toString("utf8");
      if (!text.includes("\n")) return;
      requests.push(JSON.parse(text.split("\n")[0]!) as Reply);
      connection.end(`${JSON.stringify(reply)}\n`);
    });
  });
  t.onTestFinished(() => void server.close());
  return new Promise<{ socket: string; requests: Reply[] }>((resolve) =>
    server.listen(socket, () => resolve({ socket, requests })),
  );
}

function hostedStore(socket: string, runtime = "claude") {
  const store = scratchStore({ mailbox: MAILBOX_ON });
  const session = `${runtime}-hosted-0001`;
  const pty = { socket, session: "s3", instance: "4242-1792478000000" };
  store.registry.upsert(session, { runtime, pid: process.pid, pty });
  const message = store.mailbox.send({
    from: { alias: "lead" },
    to: ["all"],
    subject: "deploy",
    body: "hold",
  });
  return { store, session, message };
}

const turned = {
  ok: true,
  outcome: "timeout",
  receipt: { accepted: true, channel: "claude-inbox", fallback: "" },
};

describe("waking a session hosted by pmcp-pty", () => {
  it("sends one turn to its host with the instance and the runtime session, and records the channel", async (t) => {
    const { socket, requests } = await host(t, turned);
    const { store, session, message } = hostedStore(socket);
    const [result] = await wakeRecipients(store, message, {
      home: "/nonexistent",
      env: {},
    });
    expect(result).toMatchObject({
      session,
      outcome: "woken",
      transport: "pmcp-pty",
      detail: "turn timeout via claude-inbox",
    });
    expect(result?.receipt).toEqual(turned);
    expect(requests).toEqual([
      {
        op: "turn",
        id: "s3",
        text: wakeText(session, [message]),
        timeout_ms: 2000,
        expect: { instance: "4242-1792478000000" },
        target: { session },
      },
    ]);
    const audit = readFileSync(join(store.dir, "messages.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(audit.at(-1)).toMatchObject({
      event: "woken",
      outcome: "woken",
      transport: "pmcp-pty",
      channel: "claude-inbox",
    });
    expect(lastWakes(store.dir).get(session)).toMatchObject({
      outcome: "woken",
      via: "claude-inbox",
    });
    expect(
      wakeableBy(
        { ...store.registry.get(session)!, live: true },
        { home: "/x", env: {} },
      ),
    ).toBe("pmcp-pty");
  });

  it("leaves the mail for the next event when the host refuses, is stale or is gone", async (t) => {
    const refused = {
      ok: true,
      outcome: "refused",
      code: "dialog_open",
      receipt: {
        accepted: false,
        reason: "dialog detected: proceed",
        channel: "screen",
        fallback: "",
      },
    };
    const a = await host(t, refused);
    const [r1] = await wakeRecipients(
      hostedStore(a.socket, "gemini").store,
      hostedStore(a.socket, "gemini").message,
      { home: "/x", env: {} },
    );
    expect(r1).toMatchObject({
      outcome: "not-wakeable",
      transport: "pmcp-pty",
    });
    expect(r1?.detail).toContain("refused: dialog detected: proceed");

    const b = await host(t, {
      ok: false,
      code: "stale",
      message: "instance is 1-2",
    });
    const s2 = hostedStore(b.socket, "grok");
    const [r2] = await wakeRecipients(s2.store, s2.message, {
      home: "/x",
      env: {},
    });
    expect(r2).toMatchObject({
      outcome: "not-wakeable",
      detail: "pmcp-pty stale: instance is 1-2",
    });

    const s3 = hostedStore(join(tmpdir(), "no-such-pmcp-pty.sock"), "codex");
    const [r3] = await wakeRecipients(s3.store, s3.message, {
      home: "/x",
      env: {},
    });
    expect(r3?.outcome).toBe("not-wakeable");
    expect(r3?.detail).toMatch(/^pmcp-pty unreachable: /u);
    expect(
      wakeableBy(
        { ...s3.store.registry.get(s3.session)!, live: true },
        { home: "/x", env: {} },
      ),
    ).toBeNull();
  });

  it("names one exact command in the wake text", () => {
    const text = wakeText("abc", [], "node '/x/cli.js'");
    expect(text).toBe(
      "pmcp mail: 0 new message(s) for you. Run exactly this one command and follow what it prints, nothing else first: node '/x/cli.js' sessions inbox --session abc",
    );
  });
});

describe("recording the pmcp-pty host at session start", () => {
  const env = {
    PMCP_PTY_SOCKET: "/run/pty.sock",
    PMCP_PTY_SESSION: "s3",
    PMCP_PTY_INSTANCE: "4242-1792478000000",
  };
  const pty = {
    socket: "/run/pty.sock",
    session: "s3",
    instance: "4242-1792478000000",
  };

  it("records it when the host daemon is the runtime's parent or grandparent", () => {
    expect(ptyFields(env, 100, () => [100, 4242, 1])).toEqual({ pty });
    expect(ptyFields(env, 100, () => [100, 90, 4242])).toEqual({ pty });
  });

  it("ignores variables a runtime inherited from a hosted session's tool shell", () => {
    expect(ptyFields(env, 100, () => [100, 90, 80, 4242])).toEqual({});
    expect(
      ptyFields({ ...env, PMCP_PTY_INSTANCE: "x-1" }, 100, () => [100, 4242]),
    ).toEqual({});
    expect(ptyFields({}, 100, () => [100, 4242])).toEqual({});
  });
});
