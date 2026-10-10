import { randomUUID } from "node:crypto";
import type { z } from "zod";

import {
  cursorSchema,
  inboxSchema,
  messageSchema,
  operationSchema,
  sendSchema,
  sessionsSchema,
  type MailboxOperation,
} from "./schemas.js";
import { MailboxStore } from "./store.js";
import {
  failure,
  MailboxError,
  type Binding,
  type Result,
  type Row,
} from "./types.js";

export class MailboxService {
  readonly store: MailboxStore;
  readonly binding: Binding;

  constructor(store: MailboxStore, binding: Binding) {
    this.store = store;
    this.binding = binding;
  }

  async call(
    operation: MailboxOperation,
    input: unknown,
  ): Promise<Result<object>> {
    try {
      operationSchema.parse(operation);
      let data: object;
      if (operation === "send") {
        data = await this.send(sendSchema.parse(input));
      } else if (operation === "inbox") {
        data = await this.inbox(inboxSchema.parse(input));
      } else if (operation === "read" || operation === "ack") {
        data = await this.receipt(
          messageSchema.parse(input).messageId,
          operation,
        );
      } else {
        sessionsSchema.parse(input);
        data = await this.sessions();
      }
      return { ok: true, data };
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return failure(
          new MailboxError(
            "invalid_input",
            "Mailbox input does not match the operation schema",
          ),
        );
      }
      return failure(error);
    }
  }

  private send(input: z.output<typeof sendSchema>): Promise<object> {
    return this.store.run(() => {
      const session = this.store.assertBinding(this.binding);
      const recipients = [
        ...new Map(
          input.recipients.map((recipient) => {
            const sessionId = recipient.sessionId ?? null;
            const key = `${recipient.actorId}/${sessionId ?? ""}`;
            return [
              key,
              { actorId: recipient.actorId, sessionId, key },
            ] as const;
          }),
        ).values(),
      ].sort((a, b) => a.key.localeCompare(b.key, "en"));
      const payload = JSON.stringify({
        body: input.body,
        replyToId: input.replyToId ?? null,
        recipients: recipients.map(({ key: _key, ...recipient }) => recipient),
      });
      const previous = this.store.database.get(
        "SELECT id, seq, thread_id, payload_json FROM mailbox_messages WHERE sender_actor_id = ? AND idempotency_key = ?",
        this.binding.actorId,
        input.idempotencyKey,
      );
      if (previous) {
        if (previous.payload_json !== payload) {
          throw new MailboxError(
            "idempotency_conflict",
            "Idempotency key was used for a different payload",
          );
        }
        return {
          messageId: previous.id,
          seq: previous.seq,
          threadId: previous.thread_id,
          duplicate: true,
        };
      }
      for (const recipient of recipients) {
        if (
          session.parent_actor_id &&
          recipient.actorId !== session.parent_actor_id
        ) {
          throw new MailboxError(
            "recipient_forbidden",
            "Child actor may send only to its parent",
          );
        }
        if (
          !this.store.database.get(
            "SELECT id FROM mailbox_actors WHERE id = ?",
            recipient.actorId,
          )
        ) {
          throw new MailboxError(
            "unknown_actor",
            "Recipient actor is not registered",
          );
        }
        if (
          recipient.sessionId &&
          !this.store.database.get(
            "SELECT id FROM mailbox_sessions WHERE id = ? AND actor_id = ?",
            recipient.sessionId,
            recipient.actorId,
          )
        ) {
          throw new MailboxError(
            "unknown_session",
            "Recipient session does not belong to the actor",
          );
        }
      }
      const id = randomUUID();
      let threadId: string = id;
      if (input.replyToId) {
        const original = this.visibleMessage(input.replyToId);
        threadId = original.thread_id as string;
        if (original.read_at_ms === null) {
          throw new MailboxError(
            "reply_requires_read",
            "Read the original message before replying",
          );
        }
      }
      this.store.database.run(
        "INSERT INTO mailbox_messages(id, sender_actor_id, sender_session_id, idempotency_key, payload_json, body, thread_id, reply_to_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        this.binding.actorId,
        this.binding.sessionId,
        input.idempotencyKey,
        payload,
        input.body,
        threadId,
        input.replyToId ?? null,
        this.store.now(),
      );
      const seq = this.store.database.get(
        "SELECT seq FROM mailbox_messages WHERE id = ?",
        id,
      )?.seq;
      if (!Number.isSafeInteger(seq)) {
        throw new MailboxError(
          "sequence_overflow",
          "Message sequence exceeds safe integer range",
        );
      }
      for (const recipient of recipients) {
        this.store.database.run(
          "INSERT INTO mailbox_receipts(message_id, target_key, actor_id, session_id) VALUES (?, ?, ?, ?)",
          id,
          recipient.key,
          recipient.actorId,
          recipient.sessionId,
        );
      }
      return { messageId: id, seq, threadId, duplicate: false };
    });
  }

  private visibleMessage(messageId: string): Row {
    const message = this.store.database.get(
      "SELECT m.*, r.target_key, r.read_at_ms, r.ack_at_ms FROM mailbox_messages m JOIN mailbox_receipts r ON r.message_id = m.id WHERE m.id = ? AND r.actor_id = ? AND (r.session_id IS NULL OR r.session_id = ?) ORDER BY r.target_key LIMIT 1",
      messageId,
      this.binding.actorId,
      this.binding.sessionId,
    );
    if (!message) {
      throw new MailboxError(
        "unknown_message",
        "Message is not available to this attachment",
      );
    }
    return message;
  }

  private inbox(input: z.output<typeof inboxSchema>): Promise<object> {
    return this.store.run(() => {
      this.store.assertBinding(this.binding);
      let after = 0;
      let upper = Number(
        this.store.database.get(
          "SELECT COALESCE(MAX(seq), 0) AS upper FROM mailbox_messages",
        )?.upper,
      );
      if (!Number.isSafeInteger(upper)) {
        throw new MailboxError(
          "sequence_overflow",
          "Message sequence exceeds safe integer range",
        );
      }
      if (input.cursor) {
        let decoded: z.output<typeof cursorSchema>;
        try {
          decoded = cursorSchema.parse(
            JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
          );
        } catch {
          throw new MailboxError("invalid_cursor", "Cursor is malformed");
        }
        if (
          decoded.projectId !== this.binding.projectId ||
          decoded.actorId !== this.binding.actorId ||
          decoded.sessionId !== this.binding.sessionId ||
          decoded.state !== input.state ||
          decoded.threadId !== (input.threadId ?? null) ||
          decoded.after > decoded.upper ||
          decoded.upper > upper
        ) {
          throw new MailboxError(
            "invalid_cursor",
            "Cursor does not match the current inbox scope",
          );
        }
        after = decoded.after;
        upper = decoded.upper;
      }
      const stateSql =
        input.state === "unread" ? "AND r.read_at_ms IS NULL" : "";
      const ackSql =
        input.state === "unacknowledged" ? "AND r.ack_at_ms IS NULL" : "";
      const threadSql = input.threadId ? "AND m.thread_id = ?" : "";
      const values = [
        this.binding.actorId,
        this.binding.sessionId,
        after,
        upper,
      ];
      if (input.threadId) {
        values.push(input.threadId);
      }
      values.push(input.limit + 1);
      const rows = this.store.database.all(
        `SELECT DISTINCT m.seq, m.id AS messageId, m.sender_actor_id AS senderActorId, m.thread_id AS threadId, m.reply_to_id AS replyToId, m.created_at_ms AS createdAtMs FROM mailbox_messages m JOIN mailbox_receipts r ON r.message_id = m.id WHERE r.actor_id = ? AND (r.session_id IS NULL OR r.session_id = ?) AND m.seq > ? AND m.seq <= ? ${stateSql} ${ackSql} ${threadSql} ORDER BY m.seq LIMIT ?`,
        ...values,
      );
      const items = rows.slice(0, input.limit);
      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const cursor = {
          version: 1,
          projectId: this.binding.projectId,
          actorId: this.binding.actorId,
          sessionId: this.binding.sessionId,
          state: input.state,
          threadId: input.threadId ?? null,
          after: items.at(-1)?.seq,
          upper,
        };
        nextCursor = Buffer.from(JSON.stringify(cursor)).toString("base64url");
      }
      return { items, nextCursor };
    }, false);
  }

  private receipt(
    messageId: string,
    operation: "read" | "ack",
  ): Promise<object> {
    return this.store.run(() => {
      this.store.assertBinding(this.binding);
      const message = this.visibleMessage(messageId);
      if (operation === "ack" && message.read_at_ms === null) {
        throw new MailboxError(
          "ack_requires_read",
          "Read the message before acknowledging it",
        );
      }
      const column = operation === "read" ? "read_at_ms" : "ack_at_ms";
      this.store.database.run(
        `UPDATE mailbox_receipts SET ${column} = COALESCE(${column}, ?) WHERE message_id = ? AND actor_id = ? AND (session_id IS NULL OR session_id = ?)`,
        this.store.now(),
        messageId,
        this.binding.actorId,
        this.binding.sessionId,
      );
      const current = this.visibleMessage(messageId);
      const data = {
        messageId,
        readAtMs: current.read_at_ms,
        ackAtMs: current.ack_at_ms,
      };
      if (operation === "ack") {
        return data;
      }
      return {
        ...data,
        body: current.body,
        senderActorId: current.sender_actor_id,
        threadId: current.thread_id,
        replyToId: current.reply_to_id,
      };
    });
  }

  private sessions(): Promise<object> {
    return this.store.run(() => {
      const session = this.store.assertBinding(this.binding);
      const scope = session.parent_actor_id
        ? "AND (s.actor_id = ? OR s.actor_id = ?)"
        : "";
      const values = session.parent_actor_id
        ? [
            this.store.now(),
            this.binding.actorId,
            session.parent_actor_id as string,
          ]
        : [this.store.now()];
      const items = this.store.database.all(
        `SELECT s.id AS sessionId, s.actor_id AS actorId, s.runtime, s.native_session_id AS nativeSessionId, s.expires_at_ms AS expiresAtMs FROM mailbox_sessions s JOIN mailbox_actors a ON a.active_session_id = s.id WHERE s.closed_at_ms IS NULL AND s.expires_at_ms > ? ${scope} ORDER BY s.actor_id`,
        ...values,
      );
      return { items };
    }, false);
  }
}
