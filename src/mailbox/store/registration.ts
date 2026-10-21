import { actorIdSchema } from "../schemas.js";
import { MailboxError, type ActorCredential, type Binding } from "../types.js";
import type { StoreContext } from "./types.js";
import { hash, secret } from "./_shared.js";
export function registerActor(
  store: StoreContext,
  actorId: string,
  parentActorId?: string,
  persist?: (credential: ActorCredential) => void,
  authorityTtlMs = 60000,
  parentBinding?: Binding,
): Promise<ActorCredential> {
  actorIdSchema.parse(actorId);
  if (parentActorId) {
    actorIdSchema.parse(parentActorId);
  }
  return store.run(() => {
    if (parentBinding) {
      store.assertBinding(parentBinding);
      if (parentActorId !== parentBinding.actorId) {
        throw new MailboxError(
          "unauthorized",
          "Delegation parent does not match the issuer",
        );
      }
    }
    if (
      store.database.get("SELECT id FROM mailbox_actors WHERE id = ?", actorId)
    ) {
      throw new MailboxError("actor_exists", "Actor is already registered");
    }
    if (
      parentActorId &&
      !store.database.get(
        "SELECT id FROM mailbox_actors WHERE id = ?",
        parentActorId,
      )
    ) {
      throw new MailboxError("unknown_actor", "Parent actor is not registered");
    }
    if (parentActorId) {
      const parent = store.database.get(
        "SELECT a.parent_actor_id, s.closed_at_ms, s.expires_at_ms FROM mailbox_actors a LEFT JOIN mailbox_sessions s ON s.id = a.active_session_id WHERE a.id = ?",
        parentActorId,
      );
      if (
        parent?.parent_actor_id ||
        parent?.closed_at_ms !== null ||
        Number(parent?.expires_at_ms ?? 0) <= store.now()
      ) {
        throw new MailboxError(
          "stale_parent",
          "Delegation requires a live root parent attachment",
        );
      }
      if (
        !Number.isSafeInteger(authorityTtlMs) ||
        authorityTtlMs < 1 ||
        authorityTtlMs > 300000
      ) {
        throw new MailboxError(
          "invalid_ttl",
          "Child authority TTL must be between 1 and 300000 milliseconds",
        );
      }
    }
    const credential = {
      projectId: store.config.projectId,
      actorId,
      secret: secret(),
    };
    store.database.run(
      "INSERT INTO mailbox_actors(id, credential_hash, parent_actor_id, parent_generation, created_at_ms, authority_expires_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
      actorId,
      hash(credential.secret),
      parentActorId ?? null,
      parentActorId
        ? Number(
            store.database.get(
              "SELECT generation FROM mailbox_actors WHERE id = ?",
              parentActorId,
            )?.generation,
          )
        : null,
      store.now(),
      parentActorId ? store.now() + authorityTtlMs : null,
    );
    persist?.(credential);
    return credential;
  });
}
