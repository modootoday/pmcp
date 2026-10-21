import { randomUUID } from "node:crypto";
import { credentialSchema, runtimeSchema } from "../schemas.js";
import { MailboxError, type ActorCredential, type Binding } from "../types.js";
import type { StoreContext } from "./types.js";
import { hash, secret, PRESENCE_TTL_MS } from "./_shared.js";
export function attach(
  store: StoreContext,
  credential: ActorCredential,
  runtime: string,
  replaceSessionId?: string,
  nativeSessionId?: string,
): Promise<Binding> {
  credentialSchema.parse(credential);
  runtimeSchema.parse(runtime);
  if (
    nativeSessionId !== undefined &&
    (nativeSessionId.length < 1 ||
      nativeSessionId.length > 256 ||
      /[\x00-\x1f]/u.test(nativeSessionId))
  ) {
    throw new MailboxError(
      "invalid_target",
      "Native session ID must be a bounded nonempty identifier",
    );
  }
  return store.run(() => {
    const actor = store.database.get(
      "SELECT * FROM mailbox_actors WHERE id = ?",
      credential.actorId,
    );
    if (
      credential.projectId !== store.config.projectId ||
      actor?.credential_hash !== hash(credential.secret)
    ) {
      throw new MailboxError("unauthorized", "Actor credential is invalid");
    }
    if (
      actor.authority_expires_at_ms !== null &&
      Number(actor.authority_expires_at_ms) <= store.now()
    ) {
      throw new MailboxError(
        "authority_expired",
        "Child authority has expired",
      );
    }
    if (actor.parent_actor_id) {
      const parent = store.database.get(
        "SELECT a.generation, s.expires_at_ms, s.closed_at_ms FROM mailbox_actors a LEFT JOIN mailbox_sessions s ON s.id = a.active_session_id WHERE a.id = ?",
        actor.parent_actor_id as string,
      );
      if (
        !parent ||
        parent.generation !== actor.parent_generation ||
        parent.closed_at_ms !== null ||
        Number(parent.expires_at_ms ?? 0) <= store.now()
      ) {
        throw new MailboxError(
          "stale_parent",
          "Parent attachment is no longer current",
        );
      }
    }
    const activeId = actor.active_session_id as string | null;
    const active = activeId
      ? store.database.get(
          "SELECT * FROM mailbox_sessions WHERE id = ?",
          activeId,
        )
      : undefined;
    if (replaceSessionId && replaceSessionId !== activeId) {
      throw new MailboxError(
        "session_conflict",
        "Expected attachment is no longer current",
      );
    }
    if (
      active &&
      Number(active.expires_at_ms) > store.now() &&
      !replaceSessionId
    ) {
      throw new MailboxError(
        "session_conflict",
        "Actor already has a live attachment",
      );
    }
    const generation = Number(actor.generation) + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new MailboxError(
        "sequence_overflow",
        "Attachment generation exceeds safe integer range",
      );
    }
    if (activeId) {
      store.database.run(
        "UPDATE mailbox_sessions SET closed_at_ms = ? WHERE id = ?",
        store.now(),
        activeId,
      );
    }
    const binding = {
      projectId: store.config.projectId,
      actorId: credential.actorId,
      sessionId: randomUUID(),
      generation,
      secret: secret(),
    };
    store.database.run(
      "INSERT INTO mailbox_sessions(id, actor_id, generation, secret_hash, runtime, native_session_id, created_at_ms, heartbeat_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      binding.sessionId,
      binding.actorId,
      generation,
      hash(binding.secret),
      runtime,
      nativeSessionId ?? null,
      store.now(),
      store.now(),
      store.now() + PRESENCE_TTL_MS,
    );
    store.database.run(
      "UPDATE mailbox_actors SET generation = ?, active_session_id = ? WHERE id = ?",
      generation,
      binding.sessionId,
      binding.actorId,
    );
    return binding;
  });
}
