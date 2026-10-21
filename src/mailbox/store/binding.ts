import { bindingSchema } from "../schemas.js";
import { MailboxError, type Binding, type Row } from "../types.js";
import type { StoreContext } from "./types.js";
import { hash, secret } from "./_shared.js";
export function assertBinding(store: StoreContext, binding: Binding): Row {
  bindingSchema.parse(binding);
  const session = store.database.get(
    "SELECT s.*, a.active_session_id, a.parent_actor_id, a.parent_generation, a.authority_expires_at_ms FROM mailbox_sessions s JOIN mailbox_actors a ON a.id = s.actor_id WHERE s.id = ?",
    binding.sessionId,
  );
  if (
    binding.projectId !== store.config.projectId ||
    !session ||
    session.actor_id !== binding.actorId ||
    session.secret_hash !== hash(binding.secret) ||
    session.generation !== binding.generation ||
    session.active_session_id !== binding.sessionId ||
    session.closed_at_ms !== null ||
    Number(session.expires_at_ms) <= store.now()
  ) {
    throw new MailboxError(
      "stale_session",
      "Attachment is invalid, expired or superseded",
    );
  }
  if (session.parent_actor_id) {
    if (Number(session.authority_expires_at_ms ?? 0) <= store.now()) {
      throw new MailboxError(
        "authority_expired",
        "Child authority has expired",
      );
    }
    const parent = store.database.get(
      "SELECT a.generation, s.closed_at_ms, s.expires_at_ms FROM mailbox_actors a LEFT JOIN mailbox_sessions s ON s.id = a.active_session_id WHERE a.id = ?",
      session.parent_actor_id as string,
    );
    if (
      parent?.generation !== session.parent_generation ||
      parent?.closed_at_ms !== null ||
      Number(parent?.expires_at_ms ?? 0) <= store.now()
    ) {
      throw new MailboxError(
        "stale_parent",
        "Parent attachment is no longer current",
      );
    }
  }
  return session;
}
