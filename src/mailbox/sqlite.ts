import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  MailboxError,
  type Database,
  type Row,
  type SqlValue,
} from "./types.js";

import { openSqlite, type SqliteHandle } from "../storage/sqlite.js";

function storageError(error: unknown): MailboxError {
  const detail = error instanceof Error ? error.message : "";
  if (/busy|locked/i.test(detail)) {
    return new MailboxError("storage_locked", "Mailbox storage is busy", true);
  }
  if (/corrupt|malformed|not a database/i.test(detail)) {
    return new MailboxError("storage_corrupt", "Mailbox storage is corrupt");
  }
  return new MailboxError(
    "storage_unavailable",
    "Mailbox storage cannot be accessed",
  );
}

export async function openDatabase(file: string): Promise<Database> {
  let native: SqliteHandle;
  try {
    if (file !== ":memory:")
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    native = (await openSqlite(file)).db;
    if (file !== ":memory:") chmodSync(file, 0o600);
  } catch (error) {
    throw storageError(error);
  }
  const invoke = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      throw storageError(error);
    }
  };
  return {
    exec: (sql) => invoke(() => native.exec(sql)),
    get: (sql, ...values) =>
      invoke(() => native.prepare(sql).get(...values) as Row | undefined),
    all: (sql, ...values) =>
      invoke(() => native.prepare(sql).all(...values) as Row[]),
    run: (sql, ...values) => {
      invoke(() => native.prepare(sql).run(...values));
    },
    close: () => native.close(),
  };
}

export async function retryLocked<T>(
  database: Database,
  operation: () => T,
): Promise<T> {
  const deadline = performance.now() + 5000;
  while (true) {
    const remaining = Math.max(1, Math.floor(deadline - performance.now()));
    database.exec(`PRAGMA busy_timeout = ${Math.min(1000, remaining)}`);
    try {
      return operation();
    } catch (error) {
      if (!(error instanceof MailboxError) || error.code !== "storage_locked") {
        throw error;
      }
      if (performance.now() >= deadline) {
        throw error;
      }
      await delay(Math.min(25, Math.max(1, deadline - performance.now())));
    }
  }
}

export function transaction<T>(
  database: Database,
  operation: () => T,
  write = true,
): Promise<T> {
  return retryLocked(database, () => {
    database.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const result = operation();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
}
