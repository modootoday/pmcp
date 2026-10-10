import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { openDatabase } from "./sqlite.js";
import { SCHEMA_VERSION } from "../storage/schema.js";
import { MailboxStore, restoreBackup } from "./store.js";
import {
  MailboxError,
  type ActorCredential,
  type MailboxConfig,
} from "./types.js";

const hash = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

export async function createRecoveryBundle(
  store: MailboxStore,
  credentials: readonly ActorCredential[],
  destination: string,
  key: Buffer,
): Promise<void> {
  if (key.length !== 32 || existsSync(destination)) {
    throw new MailboxError(
      "invalid_recovery_target",
      "Use a new destination and a 32-byte recovery key",
    );
  }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const snapshot = `${temporary}.sqlite`;
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await store.backup(snapshot);
    const probe = await openDatabase(snapshot);
    try {
      if (
        probe.get("PRAGMA integrity_check")?.integrity_check !== "ok" ||
        probe.all("PRAGMA foreign_key_check").length > 0
      ) {
        throw new MailboxError(
          "storage_corrupt",
          "Recovery snapshot failed validation",
        );
      }
      for (const credential of credentials) {
        if (
          credential.projectId !== store.config.projectId ||
          probe.get(
            "SELECT credential_hash FROM mailbox_actors WHERE id = ?",
            credential.actorId,
          )?.credential_hash !== hash(credential.secret)
        ) {
          throw new MailboxError(
            "credential_mismatch",
            "Escrow credential does not match the snapshot",
          );
        }
      }
    } finally {
      probe.close();
    }
    const database = readFileSync(snapshot);
    const manifest = {
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      projectId: store.config.projectId,
      createdAtMs: store.now(),
      providerRuntime: process.version,
      databaseSha256: hash(database),
      database: database.toString("base64"),
      credentials,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("pmcp-mailbox-recovery-v1"));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(manifest)),
      cipher.final(),
    ]);
    writeFileSync(
      temporary,
      Buffer.concat([Buffer.from("PMB1"), iv, cipher.getAuthTag(), encrypted]),
      { flag: "wx", mode: 0o600 },
    );
    const handle = openSync(temporary, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    linkSync(temporary, destination);
    const directory = openSync(dirname(destination), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    for (const file of [
      temporary,
      snapshot,
      `${snapshot}-wal`,
      `${snapshot}-shm`,
    ]) {
      rmSync(file, { force: true });
    }
  }
}

export async function restoreRecoveryBundle(
  source: string,
  config: MailboxConfig,
  key: Buffer,
): Promise<ActorCredential[]> {
  let manifest;
  try {
    const bundle = readFileSync(source);
    if (key.length !== 32 || bundle.subarray(0, 4).toString() !== "PMB1") {
      throw new Error("Invalid header");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bundle.subarray(4, 16),
    );
    decipher.setAAD(Buffer.from("pmcp-mailbox-recovery-v1"));
    decipher.setAuthTag(bundle.subarray(16, 32));
    manifest = JSON.parse(
      Buffer.concat([
        decipher.update(bundle.subarray(32)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      manifest.version !== 1 ||
      !Number.isInteger(manifest.schemaVersion) ||
      manifest.schemaVersion < 1 ||
      manifest.schemaVersion > SCHEMA_VERSION ||
      manifest.projectId !== config.projectId ||
      hash(Buffer.from(manifest.database, "base64")) !== manifest.databaseSha256
    ) {
      throw new Error("Invalid manifest");
    }
  } catch {
    throw new MailboxError(
      "invalid_recovery_bundle",
      "Recovery bundle cannot be authenticated or validated",
    );
  }
  const directory = dirname(config.databasePath);
  mkdirSync(directory, { mode: 0o700 });
  const snapshot = join(directory, ".snapshot.sqlite");
  let store;
  try {
    writeFileSync(snapshot, Buffer.from(manifest.database, "base64"), {
      flag: "wx",
      mode: 0o600,
    });
    await restoreBackup(snapshot, config);
    store = await MailboxStore.open(config);
    const actors = await store.run(
      () => store!.database.all("SELECT id FROM mailbox_actors ORDER BY id"),
      false,
    );
    const credentials: ActorCredential[] = [];
    for (const actor of actors) {
      credentials.push(await store.rotateActor(actor.id as string));
    }
    await store.close();
    unlinkSync(snapshot);
    return credentials;
  } catch (error) {
    await store?.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
