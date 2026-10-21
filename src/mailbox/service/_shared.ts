import { MailboxError, type Row } from "../types.js";
import type { ServiceContext } from "./types.js";
export function visibleMessage(
  context: ServiceContext,
  messageId: string,
): Row {
  const message = context.store.database.get(
    "SELECT m.*, r.target_key, r.read_at_ms, r.ack_at_ms FROM mailbox_messages m JOIN mailbox_receipts r ON r.message_id = m.id WHERE m.id = ? AND r.actor_id = ? AND (r.session_id IS NULL OR r.session_id = ?) ORDER BY r.target_key LIMIT 1",
    messageId,
    context.binding.actorId,
    context.binding.sessionId,
  );
  if (!message) {
    throw new MailboxError(
      "unknown_message",
      "Message is not available to context attachment",
    );
  }
  return message;
}
