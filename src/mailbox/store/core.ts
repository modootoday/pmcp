import { chmodSync, existsSync } from "node:fs";
import { SCHEMA_SQL, SCHEMA_VERSION } from "../../storage/schema.js";
import {
  migrateDatabase,
  validateMigrations,
} from "../../storage/migrations.js";
import { openDatabase, retryLocked, transaction } from "../sqlite.js";
import { credentialSchema } from "../schemas.js";
import {
  MailboxError,
  type ActorCredential,
  type Binding,
  type Database,
  type MailboxConfig,
  type Row,
} from "../types.js";
import { registerActor } from "./registration.js";
import { attach } from "./attachment.js";
import { assertBinding } from "./binding.js";
import { rotateActor } from "./rotation.js";
import { heartbeat } from "./presence.js";
import { detach } from "./presence.js";
import { exportRecords } from "./export.js";
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
    authorityTtlMs = 60000,
    parentBinding?: Binding,
  ): Promise<ActorCredential> {
    return registerActor(
      this,
      actorId,
      parentActorId,
      persist,
      authorityTtlMs,
      parentBinding,
    );
  }
  registerChild(
    parent: Binding,
    actorId: string,
    ttlMs = 60000,
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
    return attach(this, credential, runtime, replaceSessionId, nativeSessionId);
  }
  assertBinding(binding: Binding): Row {
    return assertBinding(this, binding);
  }
  rotateActor(
    actorId: string,
    persist?: (credential: ActorCredential) => void,
  ): Promise<ActorCredential> {
    return rotateActor(this, actorId, persist);
  }
  heartbeat(binding: Binding): Promise<void> {
    return heartbeat(this, binding);
  }
  detach(binding: Binding): Promise<void> {
    return detach(this, binding);
  }
  exportRecords(actorId?: string): Promise<object[]> {
    return exportRecords(this, actorId);
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
