import type { z } from "zod";
import { cursorSchema, inboxSchema } from "../schemas.js";
import { MailboxError } from "../types.js";
import type { ServiceContext } from "./types.js";
export function inbox(
  context: ServiceContext,
  input: z.output<typeof inboxSchema>,
): Promise<object> {
  return context.store.run(() => {
    context.store.assertBinding(context.binding);
    let after = 0;
    let upper = Number(
      context.store.database.get(
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
        decoded.projectId !== context.binding.projectId ||
        decoded.actorId !== context.binding.actorId ||
        decoded.sessionId !== context.binding.sessionId ||
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
    const stateSql = input.state === "unread" ? "AND r.read_at_ms IS NULL" : "";
    const ackSql =
      input.state === "unacknowledged" ? "AND r.ack_at_ms IS NULL" : "";
    const threadSql = input.threadId ? "AND m.thread_id = ?" : "";
    const values = [
      context.binding.actorId,
      context.binding.sessionId,
      after,
      upper,
    ];
    if (input.threadId) {
      values.push(input.threadId);
    }
    values.push(input.limit + 1);
    const rows = context.store.database.all(
      `SELECT DISTINCT m.seq, m.id AS messageId, m.sender_actor_id AS senderActorId, m.thread_id AS threadId, m.reply_to_id AS replyToId, m.created_at_ms AS createdAtMs FROM mailbox_messages m JOIN mailbox_receipts r ON r.message_id = m.id WHERE r.actor_id = ? AND (r.session_id IS NULL OR r.session_id = ?) AND m.seq > ? AND m.seq <= ? ${stateSql} ${ackSql} ${threadSql} ORDER BY m.seq LIMIT ?`,
      ...values,
    );
    const items = rows.slice(0, input.limit);
    let nextCursor: string | null = null;
    if (rows.length > input.limit) {
      const cursor = {
        version: 1,
        projectId: context.binding.projectId,
        actorId: context.binding.actorId,
        sessionId: context.binding.sessionId,
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
