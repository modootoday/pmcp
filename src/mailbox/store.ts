import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  constants,
  existsSync,
  unlinkSync,
} from "node:fs";

import { SCHEMA_SQL, SCHEMA_VERSION } from "../storage/schema.js";
import { migrateDatabase, validateMigrations } from "../storage/migrations.js";
import { openDatabase, retryLocked, transaction } from "./sqlite.js";
import {
  actorIdSchema,
  bindingSchema,
  credentialSchema,
  runtimeSchema,
} from "./schemas.js";
import {
  MailboxError,
  type ActorCredential,
  type Binding,
  type Database,
  type MailboxConfig,
  type Row,
} from "./types.js";

export const PRESENCE_TTL_MS = 120_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function secret(): string {
  return randomBytes(32).toString("hex");
}

export class MailboxStore {
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  readonly config: MailboxConfig;
  readonly database: Database;
  readonly now: () => number;

  private constructor(
    config: MailboxConfig,
    database: Database,
    now: () => number,
  ) {
    this.config = config;
    this.database = database;
    this.now = now;
  }

  static async open(
    config: MailboxConfig,
    now: () => number = Date.now,
  ): Promise<MailboxStore> {
    if (
      !config.databasePath ||
      !credentialSchema.shape.projectId.safeParse(config.projectId).success
    ) {
      throw new MailboxError(
        "invalid_config",
        "Provide a project UUID and database path",
      );
    }
    if (!config.enabled) {
      throw new MailboxError("mailbox_disabled", "Mailbox is disabled");
    }
    const database = await openDatabase(config.databasePath);
    const store = new MailboxStore(config, database, now);
    try {
      database.exec("PRAGMA busy_timeout = 1000");
      database.exec("PRAGMA foreign_keys = ON");
      await retryLocked(database, () =>
        database.exec("PRAGMA journal_mode = WAL"),
      );
      await transaction(database, () => {
        const version = database.get("PRAGMA user_version")?.user_version;
        if (version === 0) {
          database.exec(SCHEMA_SQL);
          database.run(
            "INSERT INTO mailbox_project(id, created_at_ms) VALUES (?, ?)",
            config.projectId,
            now(),
          );
        }
        migrateDatabase(database);
        store.checkSchema();
        validateMigrations(database);
      });
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  checkSchema(): void {
    if (
      this.database.get("PRAGMA user_version")?.user_version !== SCHEMA_VERSION
    ) {
      throw new MailboxError(
        "schema_incompatible",
        "Mailbox schema version is not supported",
      );
    }
    if (
      this.database.get("SELECT id FROM mailbox_project")?.id !==
      this.config.projectId
    ) {
      throw new MailboxError(
        "project_mismatch",
        "Mailbox database belongs to another project",
      );
    }
  }

  run<T>(operation: () => T, write = true): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new MailboxError("storage_unavailable", "Mailbox storage is closed"),
      );
    }
    const next = this.pending.then(() =>
      transaction(
        this.database,
        () => {
          this.checkSchema();
          return operation();
        },
        write,
      ),
    );
    this.pending = next.catch(() => undefined);
    return next;
  }

  registerActor(
    actorId: string,
    parentActorId?: string,
    persist?: (credential: ActorCredential) => void,
    authorityTtlMs = 60_000,
    parentBinding?: Binding,
  ): Promise<ActorCredential> {
    actorIdSchema.parse(actorId);
    if (parentActorId) {
      actorIdSchema.parse(parentActorId);
    }
    return this.run(() => {
      if (parentBinding) {
        this.assertBinding(parentBinding);
        if (parentActorId !== parentBinding.actorId) {
          throw new MailboxError(
            "unauthorized",
            "Delegation parent does not match the issuer",
          );
        }
      }
      if (
        this.database.get("SELECT id FROM mailbox_actors WHERE id = ?", actorId)
      ) {
        throw new MailboxError("actor_exists", "Actor is already registered");
      }
      if (
        parentActorId &&
        !this.database.get(
          "SELECT id FROM mailbox_actors WHERE id = ?",
          parentActorId,
        )
      ) {
        throw new MailboxError(
          "unknown_actor",
          "Parent actor is not registered",
        );
      }
      if (parentActorId) {
        const parent = this.database.get(
          "SELECT a.parent_actor_id, s.closed_at_ms, s.expires_at_ms FROM mailbox_actors a LEFT JOIN mailbox_sessions s ON s.id = a.active_session_id WHERE a.id = ?",
          parentActorId,
        );
        if (
          parent?.parent_actor_id ||
          parent?.closed_at_ms !== null ||
          Number(parent?.expires_at_ms ?? 0) <= this.now()
        ) {
          throw new MailboxError(
            "stale_parent",
            "Delegation requires a live root parent attachment",
          );
        }
        if (
          !Number.isSafeInteger(authorityTtlMs) ||
          authorityTtlMs < 1 ||
          authorityTtlMs > 300_000
        ) {
          throw new MailboxError(
            "invalid_ttl",
            "Child authority TTL must be between 1 and 300000 milliseconds",
          );
        }
      }
      const credential = {
        projectId: this.config.projectId,
        actorId,
        secret: secret(),
      };
      this.database.run(
        "INSERT INTO mailbox_actors(id, credential_hash, parent_actor_id, parent_generation, created_at_ms, authority_expires_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
        actorId,
        hash(credential.secret),
        parentActorId ?? null,
        parentActorId
          ? Number(
              this.database.get(
                "SELECT generation FROM mailbox_actors WHERE id = ?",
                parentActorId,
              )?.generation,
            )
          : null,
        this.now(),
        parentActorId ? this.now() + authorityTtlMs : null,
      );
      persist?.(credential);
      return credential;
    });
  }

  registerChild(
    parent: Binding,
    actorId: string,
    ttlMs = 60_000,
  ): Promise<ActorCredential> {
    return this.registerActor(
      actorId,
      parent.actorId,
      undefined,
      ttlMs,
      parent,
    );
  }

  attach(
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
    return this.run(() => {
      const actor = this.database.get(
        "SELECT * FROM mailbox_actors WHERE id = ?",
        credential.actorId,
      );
      if (
        credential.projectId !== this.config.projectId ||
        actor?.credential_hash !== hash(credential.secret)
      ) {
        throw new MailboxError("unauthorized", "Actor credential is invalid");
      }
      if (
        actor.authority_expires_at_ms !== null &&
        Number(actor.authority_expires_at_ms) <= this.now()
      ) {
        throw new MailboxError(
          "authority_expired",
          "Child authority has expired",
        );
      }
      if (actor.parent_actor_id) {
        const parent = this.database.get(
          "SELECT a.generation, s.expires_at_ms, s.closed_at_ms FROM mailbox_actors a LEFT JOIN mailbox_sessions s ON s.id = a.active_session_id WHERE a.id = ?",
          actor.parent_actor_id as string,
        );
        if (
          !parent ||
          parent.generation !== actor.parent_generation ||
          parent.closed_at_ms !== null ||
          Number(parent.expires_at_ms ?? 0) <= this.now()
        ) {
          throw new MailboxError(
            "stale_parent",
            "Parent attachment is no longer current",
          );
        }
      }
      const activeId = actor.active_session_id as string | null;
      const active = activeId
        ? this.database.get(
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
        Number(active.expires_at_ms) > this.now() &&
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
        this.database.run(
          "UPDATE mailbox_sessions SET closed_at_ms = ? WHERE id = ?",
          this.now(),
          activeId,
        );
      }
      const binding = {
        projectId: this.config.projectId,
        actorId: credential.actorId,
        sessionId: randomUUID(),
        generation,
        secret: secret(),
      };
      this.database.run(
        "INSERT INTO mailbox_sessions(id, actor_id, generation, secret_hash, runtime, native_session_id, created_at_ms, heartbeat_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        binding.sessionId,
        binding.actorId,
        generation,
        hash(binding.secret),
        runtime,
        nativeSessionId ?? null,
        this.now(),
        this.now(),
        this.now() + PRESENCE_TTL_MS,
      );
      this.database.run(
        "UPDATE mailbox_actors SET generation = ?, active_session_id = ? WHERE id = ?",
        generation,
        binding.sessionId,
        binding.actorId,
      );
      return binding;
    });
  }

  assertBinding(binding: Binding): Row {
    bindingSchema.parse(binding);
    const session = this.database.get(
      "SELECT s.*, a.active_session_id, a.parent_actor_id, a.parent_generation, a.authority_expires_at_ms FROM mailbox_sessions s JOIN mailbox_actors a ON a.id = s.actor_id WHERE s.id = ?",
      binding.sessionId,
    );
    if (
      binding.projectId !== this.config.projectId ||
      !session ||
      session.actor_id !== binding.actorId ||
      session.secret_hash !== hash(binding.secret) ||
      session.generation !== binding.generation ||
      session.active_session_id !== binding.sessionId ||
      session.closed_at_ms !== null ||
      Number(session.expires_at_ms) <= this.now()
    ) {
      throw new MailboxError(
        "stale_session",
        "Attachment is invalid, expired or superseded",
      );
    }
    if (session.parent_actor_id) {
      if (Number(session.authority_expires_at_ms ?? 0) <= this.now()) {
        throw new MailboxError(
          "authority_expired",
          "Child authority has expired",
        );
      }
      const parent = this.database.get(
        "SELECT a.generation, s.closed_at_ms, s.expires_at_ms FROM mailbox_actors a LEFT JOIN mailbox_sessions s ON s.id = a.active_session_id WHERE a.id = ?",
        session.parent_actor_id as string,
      );
      if (
        parent?.generation !== session.parent_generation ||
        parent?.closed_at_ms !== null ||
        Number(parent?.expires_at_ms ?? 0) <= this.now()
      ) {
        throw new MailboxError(
          "stale_parent",
          "Parent attachment is no longer current",
        );
      }
    }
    return session;
  }

  rotateActor(
    actorId: string,
    persist?: (credential: ActorCredential) => void,
  ): Promise<ActorCredential> {
    actorIdSchema.parse(actorId);
    return this.run(() => {
      if (
        !this.database.get(
          "SELECT id FROM mailbox_actors WHERE id = ?",
          actorId,
        )
      ) {
        throw new MailboxError("unknown_actor", "Actor is not registered");
      }
      const credential = {
        projectId: this.config.projectId,
        actorId,
        secret: secret(),
      };
      this.database.run(
        "UPDATE mailbox_sessions SET closed_at_ms = COALESCE(closed_at_ms, ?) WHERE actor_id = ?",
        this.now(),
        actorId,
      );
      this.database.run(
        "UPDATE mailbox_actors SET credential_hash = ?, credential_revision = credential_revision + 1, generation = generation + 1, active_session_id = NULL WHERE id = ?",
        hash(credential.secret),
        actorId,
      );
      this.database.run(
        "UPDATE mailbox_notifications SET state = 'stale', lease_token = NULL, lease_until_ms = NULL WHERE actor_id = ? AND state IN ('pending', 'leased')",
        actorId,
      );
      persist?.(credential);
      return credential;
    });
  }

  heartbeat(binding: Binding): Promise<void> {
    return this.run(() => {
      this.assertBinding(binding);
      this.database.run(
        "UPDATE mailbox_sessions SET heartbeat_at_ms = ?, expires_at_ms = ? WHERE id = ?",
        this.now(),
        this.now() + PRESENCE_TTL_MS,
        binding.sessionId,
      );
    });
  }

  detach(binding: Binding): Promise<void> {
    return this.run(() => {
      const session = this.database.get(
        "SELECT secret_hash FROM mailbox_sessions WHERE id = ?",
        binding.sessionId,
      );
      if (
        binding.projectId !== this.config.projectId ||
        session?.secret_hash !== hash(binding.secret)
      ) {
        throw new MailboxError(
          "unauthorized",
          "Attachment credential is invalid",
        );
      }
      this.database.run(
        "UPDATE mailbox_sessions SET closed_at_ms = COALESCE(closed_at_ms, ?) WHERE id = ?",
        this.now(),
        binding.sessionId,
      );
      this.database.run(
        "UPDATE mailbox_actors SET active_session_id = NULL WHERE id = ? AND active_session_id = ?",
        binding.actorId,
        binding.sessionId,
      );
    });
  }

  exportRecords(actorId?: string): Promise<object[]> {
    if (actorId) {
      actorIdSchema.parse(actorId);
    }
    return this.run(() => {
      const where = actorId
        ? "WHERE m.sender_actor_id = ? OR EXISTS (SELECT 1 FROM mailbox_receipts r WHERE r.message_id = m.id AND r.actor_id = ?)"
        : "";
      const values = actorId ? [actorId, actorId] : [];
      const messages = this.database.all(
        `SELECT m.* FROM mailbox_messages m ${where} ORDER BY m.seq`,
        ...values,
      );
      const records: object[] = [
        {
          type: "metadata",
          version: 1,
          projectId: this.config.projectId,
          exportedAtMs: this.now(),
          actorId: actorId ?? null,
        },
      ];
      for (const message of messages) {
        const { payload_json: _payload, ...data } = message;
        records.push({ type: "message", ...data });
        for (const receipt of this.database.all(
          "SELECT * FROM mailbox_receipts WHERE message_id = ? ORDER BY target_key",
          message.id as string,
        )) {
          records.push({ type: "receipt", ...receipt });
        }
      }
      return records;
    }, false);
  }

  async backup(destination: string): Promise<void> {
    if (this.closed) {
      throw new MailboxError(
        "storage_unavailable",
        "Mailbox storage is closed",
      );
    }
    if (existsSync(destination)) {
      throw new MailboxError(
        "destination_exists",
        "Backup destination already exists",
      );
    }
    const next = this.pending.then(() => {
      this.checkSchema();
      this.database.run("VACUUM INTO ?", destination);
      chmodSync(destination, 0o600);
    });
    this.pending = next.catch(() => undefined);
    await next;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pending;
    this.database.close();
  }
}

export async function restoreBackup(
  source: string,
  config: MailboxConfig,
): Promise<void> {
  copyFileSync(source, config.databasePath, constants.COPYFILE_EXCL);
  let store: MailboxStore | undefined;
  try {
    chmodSync(config.databasePath, 0o600);
    const probe = await openDatabase(config.databasePath);
    try {
      if (
        Number(probe.get("PRAGMA user_version")?.user_version) < 1 ||
        Number(probe.get("PRAGMA user_version")?.user_version) >
          SCHEMA_VERSION ||
        probe.get("SELECT id FROM mailbox_project")?.id !== config.projectId
      ) {
        throw new MailboxError(
          "schema_incompatible",
          "Backup schema or project is not compatible",
        );
      }
    } finally {
      probe.close();
    }
    store = await MailboxStore.open(config);
    const integrity = store.database.get("PRAGMA integrity_check");
    if (
      integrity?.integrity_check !== "ok" ||
      store.database.all("PRAGMA foreign_key_check").length > 0
    ) {
      throw new MailboxError(
        "storage_corrupt",
        "Restored backup failed integrity checks",
      );
    }
  } catch (error) {
    await store?.close();
    unlinkSync(config.databasePath);
    throw error;
  }
  await store.close();
}
