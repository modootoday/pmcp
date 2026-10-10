export const SCHEMA_VERSION = 3;

export const SCHEMA_SQL = `
CREATE TABLE mailbox_project (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE mailbox_actors (
  id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  parent_actor_id TEXT REFERENCES mailbox_actors(id),
  generation INTEGER NOT NULL DEFAULT 0,
  active_session_id TEXT REFERENCES mailbox_sessions(id) DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE mailbox_sessions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES mailbox_actors(id),
  generation INTEGER NOT NULL,
  secret_hash TEXT NOT NULL,
  runtime TEXT NOT NULL,
  native_session_id TEXT,
  created_at_ms INTEGER NOT NULL,
  heartbeat_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER,
  UNIQUE(actor_id, generation)
);
CREATE TABLE mailbox_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  sender_actor_id TEXT NOT NULL REFERENCES mailbox_actors(id),
  sender_session_id TEXT NOT NULL REFERENCES mailbox_sessions(id),
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  body TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES mailbox_messages(id) DEFERRABLE INITIALLY DEFERRED,
  reply_to_id TEXT REFERENCES mailbox_messages(id),
  created_at_ms INTEGER NOT NULL,
  UNIQUE(sender_actor_id, idempotency_key)
);
CREATE TABLE mailbox_receipts (
  message_id TEXT NOT NULL REFERENCES mailbox_messages(id),
  target_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES mailbox_actors(id),
  session_id TEXT REFERENCES mailbox_sessions(id),
  read_at_ms INTEGER,
  ack_at_ms INTEGER,
  PRIMARY KEY(message_id, target_key),
  CHECK(ack_at_ms IS NULL OR read_at_ms IS NOT NULL)
);
CREATE INDEX receipts_actor_session ON mailbox_receipts(actor_id, session_id, message_id);
CREATE INDEX messages_thread_seq ON mailbox_messages(thread_id, seq);
CREATE INDEX sessions_actor_presence ON mailbox_sessions(actor_id, closed_at_ms, expires_at_ms);
PRAGMA user_version = 1;
`;
