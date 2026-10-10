import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import {
  createRecoveryBundle,
  initializeMailboxConfig,
  MailboxService,
  MailboxStore,
  mailboxConfigFrom,
  NotificationOutbox,
  readCredential,
  restoreBackup,
  restoreRecoveryBundle,
  writePrivateJson,
  type Binding,
  type Result,
} from "../src/mailbox/index.js";
import { openSqlite } from "../src/storage/sqlite.js";
import { registerMailboxTools } from "../src/tools/mailbox.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function data(result: Result<object>): Record<string, unknown> {
  if (!result.ok) throw new Error(result.error.code);
  return result.data as Record<string, unknown>;
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-mailbox-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    enabled: true,
    projectId: randomUUID(),
    databasePath: join(directory, "mailbox.sqlite"),
  };
  let clock = 1_791_331_200_000;
  const store = await MailboxStore.open(config, () => clock);
  cleanup.push(() => store.close());
  const aliceCredential = await store.registerActor("alice");
  const bobCredential = await store.registerActor("bob");
  const aliceBinding = await store.attach(aliceCredential, "codex-cli");
  const bobBinding = await store.attach(bobCredential, "claude-code");
  const alice = new MailboxService(store, aliceBinding);
  const bob = new MailboxService(store, bobBinding);
  const send = (over: Record<string, unknown> = {}) =>
    alice.call("send", {
      recipients: [{ actorId: "bob" }],
      body: "\ud55c\uae00 peer data",
      idempotencyKey: randomUUID(),
      ...over,
    });
  return {
    directory,
    config,
    store,
    aliceCredential,
    bobCredential,
    aliceBinding,
    bobBinding,
    alice,
    bob,
    send,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    now: () => clock,
  };
}

describe("community mailbox", () => {
  it("keeps disabled storage unopened and rejects project substitution", async () => {
    const f = await fixture();
    const disabled = join(f.directory, "disabled", "mailbox.sqlite");
    await expect(
      MailboxStore.open({
        ...f.config,
        enabled: false,
        databasePath: disabled,
      }),
    ).rejects.toMatchObject({ code: "mailbox_disabled" });
    expect(existsSync(join(f.directory, "disabled"))).toBe(false);
    await expect(
      MailboxStore.open({ ...f.config, projectId: randomUUID() }),
    ).rejects.toMatchObject({ code: "project_mismatch" });
    const tables = f.store.database
      .all("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => row.name);
    expect(tables).toContain("mailbox_messages");
    expect(tables).not.toContain("messages");
  });

  it("commits every recipient atomically and rejects sender forgery", async () => {
    const f = await fixture();
    expect(
      await f.send({
        recipients: [{ actorId: "bob" }, { actorId: "missing" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "unknown_actor" } });
    expect(await f.send({ from: "bob" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      f.store.database.get("SELECT count(*) AS n FROM mailbox_messages")?.n,
    ).toBe(0);
    const messageId = data(await f.send()).messageId;
    expect(await f.alice.call("read", { messageId })).toMatchObject({
      ok: false,
      error: { code: "unknown_message" },
    });
  });

  it("deduplicates exact payloads while preserving read and acknowledgment semantics", async () => {
    const f = await fixture();
    const sent = data(await f.send({ idempotencyKey: "same" }));
    expect(
      data(
        await f.send({
          idempotencyKey: "same",
          recipients: [{ actorId: "bob" }, { actorId: "bob" }],
        }),
      ),
    ).toMatchObject({ messageId: sent.messageId, duplicate: true });
    expect(
      await f.send({ idempotencyKey: "same", body: "different" }),
    ).toMatchObject({ error: { code: "idempotency_conflict" } });
    await f.bob.call("inbox", {});
    expect(
      f.store.database.get("SELECT read_at_ms FROM mailbox_receipts")
        ?.read_at_ms,
    ).toBeNull();
    expect(
      await f.bob.call("ack", { messageId: sent.messageId }),
    ).toMatchObject({ error: { code: "ack_requires_read" } });
    const read = data(await f.bob.call("read", { messageId: sent.messageId }));
    f.advance(100);
    expect(
      data(await f.bob.call("read", { messageId: sent.messageId })).readAtMs,
    ).toBe(read.readAtMs);
    expect(
      data(await f.bob.call("ack", { messageId: sent.messageId })).ackAtMs,
    ).toBe(f.now());
  });

  it("bounds UTF-8 bodies and binds pagination to the recipient and snapshot", async () => {
    const f = await fixture();
    expect(await f.send({ body: "\ud55c".repeat(21846) })).toMatchObject({
      error: { code: "invalid_input" },
    });
    for (let i = 0; i < 3; i += 1) await f.send();
    const page = data(await f.bob.call("inbox", { limit: 1 }));
    await f.send();
    const rest = data(await f.bob.call("inbox", { cursor: page.nextCursor }));
    expect(rest.items).toHaveLength(2);
    expect(
      await f.alice.call("inbox", { cursor: page.nextCursor }),
    ).toMatchObject({ error: { code: "invalid_cursor" } });
  });

  it("fences replacement sessions without losing actor-addressed mail", async () => {
    const f = await fixture();
    const sent = data(await f.send());
    await expect(
      f.store.attach(f.bobCredential, "gemini-cli"),
    ).rejects.toMatchObject({ code: "session_conflict" });
    const current = await f.store.attach(
      f.bobCredential,
      "gemini-cli",
      f.bobBinding.sessionId,
    );
    expect(await f.bob.call("inbox", {})).toMatchObject({
      error: { code: "stale_session" },
    });
    await f.store.detach(f.bobBinding);
    expect(
      data(
        await new MailboxService(f.store, current).call("read", {
          messageId: sent.messageId,
        }),
      ).body,
    ).toBe("\ud55c\uae00 peer data");
  });

  it("expires child authority and prevents sibling or grandchild escalation", async () => {
    const f = await fixture();
    const credential = await f.store.registerChild(f.aliceBinding, "child");
    const binding = await f.store.attach(credential, "antigravity");
    const child = new MailboxService(f.store, binding);
    expect(data(await child.call("sessions", {})).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: "alice" }),
        expect.objectContaining({ actorId: "child" }),
      ]),
    );
    expect(data(await child.call("sessions", {})).items).toHaveLength(2);
    expect(
      await child.call("send", {
        recipients: [{ actorId: "bob" }],
        body: "no",
        idempotencyKey: "no",
      }),
    ).toMatchObject({ error: { code: "recipient_forbidden" } });
    await expect(
      f.store.registerChild(binding, "grandchild"),
    ).rejects.toMatchObject({ code: "stale_parent" });
    f.advance(60_001);
    expect(await child.call("inbox", {})).toMatchObject({
      error: { code: "authority_expired" },
    });
  });

  it("keeps uncertain notification delivery fenced until explicitly reconciled", async () => {
    const f = await fixture();
    const sent = data(await f.send());
    const outbox = new NotificationOutbox(f.store);
    await outbox.discover(f.bobBinding, "owned-native-id");
    const claim = (await outbox.claim(f.bobBinding))!;
    f.advance(20_001);
    expect(await outbox.claim(f.bobBinding)).toBeUndefined();
    await expect(
      outbox.complete(f.bobBinding, claim, "accepted"),
    ).rejects.toMatchObject({ code: "stale_lease" });
    await outbox.reconcile(f.bobBinding, sent.messageId as string, true);
    expect(
      f.store.database.get("SELECT state FROM mailbox_notifications")?.state,
    ).toBe("accepted");
  });

  it("restores a consistent backup and preserves idempotency across process ownership", async () => {
    const f = await fixture();
    const sent = data(await f.send({ idempotencyKey: "persist" }));
    await f.bob.call("read", { messageId: sent.messageId });
    await f.bob.call("ack", { messageId: sent.messageId });
    const backup = join(f.directory, "backup.sqlite");
    await f.store.backup(backup);
    const config = {
      ...f.config,
      databasePath: join(f.directory, "restored.sqlite"),
    };
    await restoreBackup(backup, config);
    const restored = await MailboxStore.open(config, f.now);
    cleanup.push(() => restored.close());
    const binding = await restored.attach(
      f.aliceCredential,
      "grok-cli",
      f.aliceBinding.sessionId,
    );
    expect(
      data(
        await new MailboxService(restored, binding).call("send", {
          recipients: [{ actorId: "bob" }],
          body: "\ud55c\uae00 peer data",
          idempotencyKey: "persist",
        }),
      ).messageId,
    ).toBe(sent.messageId);
    expect(
      restored.database.get("SELECT ack_at_ms FROM mailbox_receipts")
        ?.ack_at_ms,
    ).toBeTruthy();
  });

  it("authenticates encrypted recovery and rotates restored authority", async () => {
    const f = await fixture();
    await f.send();
    const key = randomBytes(32);
    const bundle = join(f.directory, "recovery.pmb");
    await createRecoveryBundle(
      f.store,
      [f.aliceCredential, f.bobCredential],
      bundle,
      key,
    );
    const config = {
      ...f.config,
      databasePath: join(f.directory, "recovered", "mailbox.sqlite"),
    };
    await expect(
      restoreRecoveryBundle(bundle, config, randomBytes(32)),
    ).rejects.toMatchObject({ code: "invalid_recovery_bundle" });
    expect(existsSync(join(f.directory, "recovered"))).toBe(false);
    const credentials = await restoreRecoveryBundle(bundle, config, key);
    const recovered = await MailboxStore.open(config);
    cleanup.push(() => recovered.close());
    await expect(
      recovered.attach(f.aliceCredential, "codex-cli"),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(credentials).toHaveLength(2);
  });

  it("rejects corruption and future schemas without replacing the database", async () => {
    const f = await fixture();
    const corrupt = join(f.directory, "corrupt.sqlite");
    writeFileSync(corrupt, "not a database");
    await expect(
      MailboxStore.open({ ...f.config, databasePath: corrupt }),
    ).rejects.toMatchObject({ code: "storage_corrupt" });
    expect(readFileSync(corrupt, "utf8")).toBe("not a database");
    const other = await openSqlite(f.config.databasePath);
    other.db.exec("PRAGMA user_version = 99");
    other.db.close();
    expect(await f.bob.call("inbox", {})).toMatchObject({
      error: { code: "schema_incompatible" },
    });
  });

  it("preserves catalog and projector sections while adding portable mailbox configuration", async () => {
    const f = await fixture();
    const path = join(f.directory, "pmcp.toml");
    writeFileSync(
      path,
      '[catalog]\nscopes = ["@acme/"]\n[targets]\ntools = ["codex"]\n',
    );
    initializeMailboxConfig(path);
    const project = readConfig(path);
    expect(project.catalog.scopes).toEqual(["@acme/"]);
    expect(project.raw.targets).toEqual({ tools: ["codex"] });
    expect(mailboxConfigFrom(project)?.enabled).toBe(true);
    expect(readFileSync(path, "utf8")).not.toContain("/home/");
  });

  it("refuses public or symlinked launcher credential files", async () => {
    const f = await fixture();
    const path = join(f.directory, "actor.json");
    writePrivateJson(path, f.aliceCredential);
    expect(readCredential(path)).toEqual(f.aliceCredential);
    chmodSync(path, 0o644);
    expect(() => readCredential(path)).toThrow("private regular");
    chmodSync(path, 0o600);
    const link = join(f.directory, "actor-link.json");
    symlinkSync(path, link);
    expect(() => readCredential(link)).toThrow();
  });

  it("rolls back credential rotation when persistence fails", async () => {
    const f = await fixture();
    await expect(
      f.store.rotateActor("alice", () => {
        throw new Error("disk failure");
      }),
    ).rejects.toThrow("disk failure");
    expect(await f.alice.call("inbox", {})).toMatchObject({ ok: true });
  });

  it("registers five bounded tools with mutation annotations and sanitized errors", async () => {
    const f = await fixture();
    const registered: {
      name: string;
      config: { annotations: { readOnlyHint: boolean } };
      handler: (input: unknown) => Promise<unknown>;
    }[] = [];
    const server = {
      registerTool: (
        name: string,
        config: (typeof registered)[number]["config"],
        handler: (typeof registered)[number]["handler"],
      ) => {
        registered.push({ name, config, handler });
      },
    };
    registerMailboxTools(server as never, f.bob);
    expect(registered).toHaveLength(5);
    expect(
      registered.find((tool) => tool.name === "mailbox_inbox")?.config
        .annotations.readOnlyHint,
    ).toBe(true);
    const read = registered.find((tool) => tool.name === "mailbox_read")!;
    expect(read.config.annotations.readOnlyHint).toBe(false);
    expect(await read.handler({ messageId: randomUUID() })).toMatchObject({
      isError: true,
    });
    expect(await read.handler({ messageId: randomUUID() })).not.toHaveProperty(
      "structuredContent",
    );
  });
});
