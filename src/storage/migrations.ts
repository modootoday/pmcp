import { createHash } from "node:crypto";

import { MailboxError, type Database } from "../mailbox/types.js";

export const MIGRATION_2 = `
ALTER TABLE mailbox_actors ADD COLUMN credential_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mailbox_actors ADD COLUMN parent_generation INTEGER;
UPDATE mailbox_actors SET parent_generation = (SELECT generation FROM mailbox_actors p WHERE p.id = mailbox_actors.parent_actor_id) WHERE parent_actor_id IS NOT NULL;
CREATE TABLE mailbox_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL);
CREATE TABLE mailbox_notifications (
  message_id TEXT NOT NULL REFERENCES mailbox_messages(id),
  actor_id TEXT NOT NULL REFERENCES mailbox_actors(id),
  session_id TEXT NOT NULL REFERENCES mailbox_sessions(id),
  generation INTEGER NOT NULL,
  native_target TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'accepted', 'uncertain', 'failed', 'stale')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until_ms INTEGER,
  next_attempt_ms INTEGER NOT NULL,
  outcome_code TEXT,
  PRIMARY KEY(message_id, actor_id, session_id)
);
CREATE INDEX notifications_pending ON mailbox_notifications(state, next_attempt_ms);
`;

export function migrateDatabase(database: Database): void {
  let version = database.get("PRAGMA user_version")?.user_version;
  if (version === 1) {
    database.exec(MIGRATION_2);
    database.run(
      "INSERT INTO mailbox_migrations(version, checksum) VALUES (?, ?)",
      2,
      createHash("sha256").update(MIGRATION_2).digest("hex"),
    );
    database.exec("PRAGMA user_version = 2");
    version = 2;
  }
  if (version === 2) {
    database.exec(MIGRATION_3);
    database.run(
      "INSERT INTO mailbox_migrations(version, checksum) VALUES (?, ?)",
      3,
      createHash("sha256").update(MIGRATION_3).digest("hex"),
    );
    database.exec("PRAGMA user_version = 3");
  }
  if (database.all("PRAGMA foreign_key_check").length > 0) {
    throw new MailboxError(
      "storage_corrupt",
      "Migration failed foreign key validation",
    );
  }
}

export const MIGRATION_3 = `
ALTER TABLE mailbox_actors ADD COLUMN authority_expires_at_ms INTEGER;
UPDATE mailbox_actors SET authority_expires_at_ms = created_at_ms + 60000 WHERE parent_actor_id IS NOT NULL;
`;

export function validateMigrations(database: Database): void {
  for (const [version, sql] of [
    [2, MIGRATION_2],
    [3, MIGRATION_3],
  ] as const) {
    const expected = createHash("sha256").update(sql).digest("hex");
    if (
      database.get(
        "SELECT checksum FROM mailbox_migrations WHERE version = ?",
        version,
      )?.checksum !== expected
    ) {
      throw new MailboxError(
        "schema_incompatible",
        "Migration checksum does not match the supported schema",
      );
    }
  }
}
