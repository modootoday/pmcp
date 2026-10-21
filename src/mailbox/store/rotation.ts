import { actorIdSchema } from "../schemas.js";
import { MailboxError, type ActorCredential } from "../types.js";
import type { StoreContext } from "./types.js";
import { hash, secret } from "./_shared.js";
export function rotateActor(
  store: StoreContext,
  actorId: string,
  persist?: (credential: ActorCredential) => void,
): Promise<ActorCredential> {
  actorIdSchema.parse(actorId);
  return store.run(() => {
    if (
      !store.database.get("SELECT id FROM mailbox_actors WHERE id = ?", actorId)
    ) {
      throw new MailboxError("unknown_actor", "Actor is not registered");
    }
    const credential = {
      projectId: store.config.projectId,
      actorId,
      secret: secret(),
    };
    store.database.run(
      "UPDATE mailbox_sessions SET closed_at_ms = COALESCE(closed_at_ms, ?) WHERE actor_id = ?",
      store.now(),
      actorId,
    );
    store.database.run(
      "UPDATE mailbox_actors SET credential_hash = ?, credential_revision = credential_revision + 1, generation = generation + 1, active_session_id = NULL WHERE id = ?",
      hash(credential.secret),
      actorId,
    );
    store.database.run(
      "UPDATE mailbox_notifications SET state = 'stale', lease_token = NULL, lease_until_ms = NULL WHERE actor_id = ? AND state IN ('pending', 'leased')",
      actorId,
    );
    persist?.(credential);
    return credential;
  });
}
