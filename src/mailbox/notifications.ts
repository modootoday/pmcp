import { randomUUID } from "node:crypto";

import { MailboxStore } from "./store.js";
import { MailboxError, type Binding, type Row } from "./types.js";

export class NotificationOutbox {
  constructor(readonly store: MailboxStore) {}

  discover(binding: Binding, nativeTarget: string): Promise<void> {
    return this.store.run(() => {
      this.store.assertBinding(binding);
      if (!nativeTarget) {
        throw new MailboxError("invalid_target", "Native target is required");
      }
      this.store.database.run(
        "UPDATE mailbox_notifications SET state = 'stale', lease_token = NULL, lease_until_ms = NULL WHERE actor_id = ? AND session_id != ? AND state IN ('pending', 'leased')",
        binding.actorId,
        binding.sessionId,
      );
      this.store.database.run(
        "INSERT OR IGNORE INTO mailbox_notifications(message_id, actor_id, session_id, generation, native_target, state, next_attempt_ms) SELECT DISTINCT r.message_id, r.actor_id, ?, ?, ?, 'pending', ? FROM mailbox_receipts r WHERE r.actor_id = ? AND r.ack_at_ms IS NULL AND (r.session_id IS NULL OR r.session_id = ?) AND NOT EXISTS (SELECT 1 FROM mailbox_notifications n WHERE n.message_id = r.message_id AND n.actor_id = r.actor_id AND n.session_id = ?) ORDER BY r.message_id LIMIT 100",
        binding.sessionId,
        binding.generation,
        nativeTarget,
        this.store.now(),
        binding.actorId,
        binding.sessionId,
        binding.sessionId,
      );
    });
  }

  retryUnsent(binding: Binding, claim: Row): Promise<void> {
    return this.store.run(() => {
      this.assertLease(binding, claim);
      const attempts = Number(claim.attempts);
      this.store.database.run(
        "UPDATE mailbox_notifications SET state = ?, outcome_code = 'known_unsent', lease_token = NULL, lease_until_ms = NULL, next_attempt_ms = ? WHERE message_id = ? AND actor_id = ? AND session_id = ?",
        attempts >= 3 ? "failed" : "pending",
        this.store.now() + Math.min(2000, 100 * 2 ** (attempts - 1)),
        claim.message_id as string,
        binding.actorId,
        binding.sessionId,
      );
    });
  }

  reconcile(
    binding: Binding,
    messageId: string,
    delivered: boolean,
  ): Promise<void> {
    return this.store.run(() => {
      this.store.assertBinding(binding);
      const row = this.store.database.get(
        "SELECT state, attempts FROM mailbox_notifications WHERE message_id = ? AND actor_id = ? AND session_id = ?",
        messageId,
        binding.actorId,
        binding.sessionId,
      );
      if (row?.state !== "uncertain") {
        throw new MailboxError(
          "reconciliation_conflict",
          "Only uncertain delivery can be reconciled",
        );
      }
      let state = "pending";
      if (delivered) {
        state = "accepted";
      } else if (Number(row.attempts) >= 3) {
        state = "failed";
      }
      this.store.database.run(
        "UPDATE mailbox_notifications SET state = ?, outcome_code = 'operator_reconciled', next_attempt_ms = ? WHERE message_id = ? AND actor_id = ? AND session_id = ?",
        state,
        this.store.now(),
        messageId,
        binding.actorId,
        binding.sessionId,
      );
    });
  }

  enqueue(
    messageId: string,
    binding: Binding,
    nativeTarget: string,
  ): Promise<void> {
    return this.store.run(() => {
      this.store.assertBinding(binding);
      const receipt = this.store.database.get(
        "SELECT session_id FROM mailbox_receipts WHERE message_id = ? AND actor_id = ? AND (session_id IS NULL OR session_id = ?)",
        messageId,
        binding.actorId,
        binding.sessionId,
      );
      if (!receipt || !nativeTarget) {
        throw new MailboxError(
          "unknown_message",
          "Notification target is not a recipient",
        );
      }
      this.store.database.run(
        "INSERT OR IGNORE INTO mailbox_notifications(message_id, actor_id, session_id, generation, native_target, state, next_attempt_ms) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
        messageId,
        binding.actorId,
        binding.sessionId,
        binding.generation,
        nativeTarget,
        this.store.now(),
      );
    });
  }

  claim(binding: Binding): Promise<Row | undefined> {
    return this.store.run(() => {
      this.store.assertBinding(binding);
      this.store.database.run(
        "UPDATE mailbox_notifications SET state = 'uncertain', outcome_code = 'dispatcher_lost', lease_token = NULL WHERE actor_id = ? AND state = 'leased' AND lease_until_ms <= ?",
        binding.actorId,
        this.store.now(),
      );
      const row = this.store.database.get(
        "SELECT * FROM mailbox_notifications WHERE actor_id = ? AND session_id = ? AND generation = ? AND state = 'pending' AND next_attempt_ms <= ? AND attempts < 3 ORDER BY next_attempt_ms LIMIT 1",
        binding.actorId,
        binding.sessionId,
        binding.generation,
        this.store.now(),
      );
      if (!row) {
        return undefined;
      }
      const leaseToken = randomUUID();
      this.store.database.run(
        "UPDATE mailbox_notifications SET state = 'leased', attempts = attempts + 1, lease_token = ?, lease_until_ms = ? WHERE message_id = ? AND actor_id = ? AND session_id = ?",
        leaseToken,
        this.store.now() + 20_000,
        row.message_id as string,
        binding.actorId,
        binding.sessionId,
      );
      return { ...row, leaseToken, attempts: Number(row.attempts) + 1 };
    });
  }

  renew(binding: Binding, claim: Row): Promise<void> {
    return this.store.run(() => {
      this.assertLease(binding, claim);
      this.store.database.run(
        "UPDATE mailbox_notifications SET lease_until_ms = ? WHERE message_id = ? AND actor_id = ? AND session_id = ?",
        this.store.now() + 20_000,
        claim.message_id as string,
        binding.actorId,
        binding.sessionId,
      );
    });
  }

  private assertLease(binding: Binding, claim: Row): void {
    this.store.assertBinding(binding);
    const lease = this.store.database.get(
      "SELECT state, lease_token, lease_until_ms FROM mailbox_notifications WHERE message_id = ? AND actor_id = ? AND session_id = ?",
      claim.message_id as string,
      binding.actorId,
      binding.sessionId,
    );
    if (
      lease?.state !== "leased" ||
      lease.lease_token !== claim.leaseToken ||
      Number(lease.lease_until_ms) <= this.store.now()
    ) {
      throw new MailboxError(
        "stale_lease",
        "Notification lease is no longer current",
      );
    }
  }

  complete(
    binding: Binding,
    claim: Row,
    outcome: "accepted" | "uncertain" | "failed",
  ): Promise<void> {
    return this.store.run(() => {
      this.assertLease(binding, claim);
      this.store.database.run(
        "UPDATE mailbox_notifications SET state = ?, outcome_code = ?, lease_token = NULL, lease_until_ms = NULL WHERE message_id = ? AND actor_id = ? AND session_id = ?",
        outcome,
        outcome,
        claim.message_id as string,
        binding.actorId,
        binding.sessionId,
      );
    });
  }
}
