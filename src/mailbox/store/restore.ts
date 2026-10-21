import { chmodSync, copyFileSync, constants, unlinkSync } from "node:fs";
import { SCHEMA_VERSION } from "../../storage/schema.js";
import { openDatabase } from "../sqlite.js";
import { MailboxError, type MailboxConfig } from "../types.js";
import { MailboxStore } from "./core.js";
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
