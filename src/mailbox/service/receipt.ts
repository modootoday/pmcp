import { MailboxError } from "../types.js";
import type { ServiceContext } from "./types.js";
import { visibleMessage } from "./_shared.js";
export function receipt(
  context: ServiceContext,
  messageId: string,
  operation: "read" | "ack",
): Promise<object> {
  return context.store.run(() => {
    context.store.assertBinding(context.binding);
    const message = visibleMessage(context, messageId);
    if (operation === "ack" && message.read_at_ms === null) {
      throw new MailboxError(
        "ack_requires_read",
        "Read the message before acknowledging it",
      );
    }
    const column = operation === "read" ? "read_at_ms" : "ack_at_ms";
    context.store.database.run(
      `UPDATE mailbox_receipts SET ${column} = COALESCE(${column}, ?) WHERE message_id = ? AND actor_id = ? AND (session_id IS NULL OR session_id = ?)`,
      context.store.now(),
      messageId,
      context.binding.actorId,
      context.binding.sessionId,
    );
    const current = visibleMessage(context, messageId);
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
