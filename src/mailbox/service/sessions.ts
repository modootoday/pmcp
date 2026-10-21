import type { ServiceContext } from "./types.js";
export function sessions(context: ServiceContext): Promise<object> {
  return context.store.run(() => {
    const session = context.store.assertBinding(context.binding);
    const scope = session.parent_actor_id
      ? "AND (s.actor_id = ? OR s.actor_id = ?)"
      : "";
    const values = session.parent_actor_id
      ? [
          context.store.now(),
          context.binding.actorId,
          session.parent_actor_id as string,
        ]
      : [context.store.now()];
    const items = context.store.database.all(
      `SELECT s.id AS sessionId, s.actor_id AS actorId, s.runtime, s.native_session_id AS nativeSessionId, s.expires_at_ms AS expiresAtMs FROM mailbox_sessions s JOIN mailbox_actors a ON a.active_session_id = s.id WHERE s.closed_at_ms IS NULL AND s.expires_at_ms > ? ${scope} ORDER BY s.actor_id`,
      ...values,
    );
    return { items };
  }, false);
}
