import { actorIdSchema } from "../schemas.js";
import type { StoreContext } from "./types.js";
export function exportRecords(
  store: StoreContext,
  actorId?: string,
): Promise<object[]> {
  if (actorId) {
    actorIdSchema.parse(actorId);
  }
  return store.run(() => {
    const where = actorId
      ? "WHERE m.sender_actor_id = ? OR EXISTS (SELECT 1 FROM mailbox_receipts r WHERE r.message_id = m.id AND r.actor_id = ?)"
      : "";
    const values = actorId ? [actorId, actorId] : [];
    const messages = store.database.all(
      `SELECT m.* FROM mailbox_messages m ${where} ORDER BY m.seq`,
      ...values,
    );
    const records: object[] = [
      {
        type: "metadata",
        version: 1,
        projectId: store.config.projectId,
        exportedAtMs: store.now(),
        actorId: actorId ?? null,
      },
    ];
    for (const message of messages) {
      const { payload_json: _payload, ...data } = message;
      records.push({ type: "message", ...data });
      for (const receipt of store.database.all(
        "SELECT * FROM mailbox_receipts WHERE message_id = ? ORDER BY target_key",
        message.id as string,
      )) {
        records.push({ type: "receipt", ...receipt });
      }
    }
    return records;
  }, false);
}
