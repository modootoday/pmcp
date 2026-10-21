import { MailboxError, type Binding } from "../types.js";
import type { StoreContext } from "./types.js";
import { hash, secret, PRESENCE_TTL_MS } from "./_shared.js";
export function heartbeat(
  store: StoreContext,
  binding: Binding,
): Promise<void> {
  return store.run(() => {
    store.assertBinding(binding);
    store.database.run(
      "UPDATE mailbox_sessions SET heartbeat_at_ms = ?, expires_at_ms = ? WHERE id = ?",
      store.now(),
      store.now() + PRESENCE_TTL_MS,
      binding.sessionId,
    );
  });
}
export function detach(store: StoreContext, binding: Binding): Promise<void> {
  return store.run(() => {
    const session = store.database.get(
      "SELECT secret_hash FROM mailbox_sessions WHERE id = ?",
      binding.sessionId,
    );
    if (
      binding.projectId !== store.config.projectId ||
      session?.secret_hash !== hash(binding.secret)
    ) {
      throw new MailboxError(
        "unauthorized",
        "Attachment credential is invalid",
      );
    }
    store.database.run(
      "UPDATE mailbox_sessions SET closed_at_ms = COALESCE(closed_at_ms, ?) WHERE id = ?",
      store.now(),
      binding.sessionId,
    );
    store.database.run(
      "UPDATE mailbox_actors SET active_session_id = NULL WHERE id = ? AND active_session_id = ?",
      binding.actorId,
      binding.sessionId,
    );
  });
}
