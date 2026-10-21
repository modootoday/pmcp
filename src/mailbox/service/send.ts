import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { sendSchema } from "../schemas.js";
import { MailboxError } from "../types.js";
import type { ServiceContext } from "./types.js";
import { visibleMessage } from "./_shared.js";
export function send(
  context: ServiceContext,
  input: z.output<typeof sendSchema>,
): Promise<object> {
  return context.store.run(() => {
    const session = context.store.assertBinding(context.binding);
    const recipients = [
      ...new Map(
        input.recipients.map((recipient) => {
          const sessionId = recipient.sessionId ?? null;
          const key = `${recipient.actorId}/${sessionId ?? ""}`;
          return [key, { actorId: recipient.actorId, sessionId, key }] as const;
        }),
      ).values(),
    ].sort((a, b) => a.key.localeCompare(b.key, "en"));
    const payload = JSON.stringify({
      body: input.body,
      replyToId: input.replyToId ?? null,
      recipients: recipients.map(({ key: _key, ...recipient }) => recipient),
    });
    const previous = context.store.database.get(
      "SELECT id, seq, thread_id, payload_json FROM mailbox_messages WHERE sender_actor_id = ? AND idempotency_key = ?",
      context.binding.actorId,
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
        !context.store.database.get(
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
        !context.store.database.get(
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
      const original = visibleMessage(context, input.replyToId);
      threadId = original.thread_id as string;
      if (original.read_at_ms === null) {
        throw new MailboxError(
          "reply_requires_read",
          "Read the original message before replying",
        );
      }
    }
    context.store.database.run(
      "INSERT INTO mailbox_messages(id, sender_actor_id, sender_session_id, idempotency_key, payload_json, body, thread_id, reply_to_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      context.binding.actorId,
      context.binding.sessionId,
      input.idempotencyKey,
      payload,
      input.body,
      threadId,
      input.replyToId ?? null,
      context.store.now(),
    );
    const seq = context.store.database.get(
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
      context.store.database.run(
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
