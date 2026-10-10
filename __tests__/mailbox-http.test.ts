import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSkillHttpHandler } from "../src/http.js";
import { MailboxService, MailboxStore } from "../src/mailbox/index.js";

it("binds HTTP mailbox authority to the authenticated caller across replacement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-http-mailbox-"));
  const store = await MailboxStore.open({
    enabled: true,
    projectId: randomUUID(),
    databasePath: join(directory, "mailbox.sqlite"),
  });
  try {
    const aliceCredential = await store.registerActor("alice");
    const aliceBinding = await store.attach(aliceCredential, "codex-cli");
    const bobBinding = await store.attach(
      await store.registerActor("bob"),
      "claude-code",
    );
    const services = new Map([
      ["alice", new MailboxService(store, aliceBinding)],
      ["bob", new MailboxService(store, bobBinding)],
    ]);
    let resolved = 0;
    const handler = createSkillHttpHandler({
      roots: [],
      loadCatalog: () => [],
      authorize: (request) => {
        const id = request.headers.get("authorization");
        return id ? { id } : undefined;
      },
      mailboxFor: (caller) => {
        resolved += 1;
        return services.get(caller.id);
      },
    });
    const rpc = async (caller: string, method: string, params: object = {}) => {
      const response = await handler.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            authorization: caller,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-06-18",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      const text = await response.text();
      const json = text.startsWith("{")
        ? text
        : text
            .split("\n")
            .find((line) => line.startsWith("data:"))!
            .slice(5);
      return JSON.parse(json).result;
    };
    const call = async (caller: string, name: string, input: object) => {
      const result = await rpc(caller, "tools/call", {
        name,
        arguments: input,
      });
      return JSON.parse(result.content[0].text);
    };
    const anonymous = await handler.fetch(
      new Request("http://localhost/mcp", { method: "POST", body: "{}" }),
    );
    expect(anonymous.status).toBe(401);
    expect(resolved).toBe(0);
    expect((await rpc("catalog-only", "tools/list")).tools).toHaveLength(6);
    expect((await rpc("alice", "tools/list")).tools).toHaveLength(11);
    const sent = await call("alice", "mailbox_send", {
      recipients: [{ actorId: "bob" }],
      body: "private peer data",
      idempotencyKey: "http-send",
    });
    expect(sent.ok).toBe(true);
    expect(
      (await call("alice", "mailbox_read", { messageId: sent.data.messageId }))
        .error.code,
    ).toBe("unknown_message");
    const received = await call("bob", "mailbox_read", {
      messageId: sent.data.messageId,
    });
    expect(received.data.body).toBe("private peer data");
    expect(received.data.senderActorId).toBe("alice");
    expect(
      (
        await rpc("bob", "tools/call", {
          name: "mailbox_send",
          arguments: {
            senderActorId: "alice",
            recipients: [{ actorId: "alice" }],
            body: "forged",
            idempotencyKey: "forgery",
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      store.database.get("SELECT COUNT(*) AS count FROM mailbox_messages")
        ?.count,
    ).toBe(1);
    const replacement = await store.attach(
      aliceCredential,
      "gemini-cli",
      aliceBinding.sessionId,
    );
    services.set("alice", new MailboxService(store, replacement));
    const sessions = await call("alice", "mailbox_sessions", {});
    expect(sessions.ok).toBe(true);
    expect(
      sessions.data.items.find(
        (item: { actorId: string }) => item.actorId === "alice",
      ).sessionId,
    ).toBe(replacement.sessionId);
    await store.rotateActor("alice");
    expect((await call("alice", "mailbox_inbox", {})).error.code).toBe(
      "stale_session",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
