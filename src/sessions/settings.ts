import { projectStateDir } from "./state-dir.js";
import { createFilesStore } from "./files-store.js";
import type { MailboxSettings, SessionStore } from "./types.js";

export interface StoreSettings {
  readonly stateDir?: string;
  readonly staleMs: number;
  readonly keepBroadcasts: number;
  readonly mailbox?: MailboxSettings;
}

const MAILBOX_KEYS = [
  "enabled",
  "ttl_minutes",
  "max_delivered",
  "audit",
  "wake",
];

function flag(value: unknown, where: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new Error(`${where} must be true or false`);
  return value;
}

// A missing [sessions.mailbox] table leaves the mailbox off; a declared one turns it on.
export function readMailbox(raw: unknown): MailboxSettings {
  if (raw === undefined)
    return { enabled: false, ttlMinutes: 1440, maxDelivered: 5, audit: true };
  const mailbox = table(raw, "[sessions.mailbox]");
  const unknown = Object.keys(mailbox).find(
    (key) => !MAILBOX_KEYS.includes(key),
  );
  if (unknown) throw new Error(`[sessions.mailbox] unknown key ${unknown}`);
  return {
    enabled: flag(mailbox["enabled"], "[sessions.mailbox] enabled", true),
    ttlMinutes: positiveInteger(
      mailbox["ttl_minutes"],
      "[sessions.mailbox] ttl_minutes",
      1440,
    ),
    maxDelivered: positiveInteger(
      mailbox["max_delivered"],
      "[sessions.mailbox] max_delivered",
      5,
    ),
    audit: flag(mailbox["audit"], "[sessions.mailbox] audit", true),
    // Only when on, so mailboxes without wake keep the same compiled policy and hash.
    ...(flag(mailbox["wake"], "[sessions.mailbox] wake", false)
      ? { wake: true }
      : {}),
  };
}

function table(
  value: unknown,
  where: string,
): Readonly<Record<string, unknown>> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${where} must be a table`);
  return value as Record<string, unknown>;
}

function positiveInteger(
  value: unknown,
  where: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${where} must be a positive integer`);
  }
  return value;
}

export function readStoreSettings(raw: unknown): StoreSettings {
  const sessions = table(raw, "[sessions]");
  if ((sessions["store"] ?? "files") !== "files")
    throw new Error('[sessions] store must be "files"');
  const stateDir = sessions["state_dir"];
  if (
    stateDir !== undefined &&
    (typeof stateDir !== "string" || stateDir === "")
  ) {
    throw new Error("[sessions] state_dir must be a path");
  }
  const registry = table(sessions["registry"], "[sessions.registry]");
  const broadcast = table(sessions["broadcast"], "[sessions.broadcast]");
  return {
    ...(typeof stateDir === "string" ? { stateDir } : {}),
    staleMs:
      positiveInteger(
        registry["stale_minutes"],
        "[sessions.registry] stale_minutes",
        30,
      ) * 60_000,
    keepBroadcasts: positiveInteger(
      broadcast["keep"],
      "[sessions.broadcast] keep",
      10,
    ),
    mailbox: readMailbox(sessions["mailbox"]),
  };
}

export function openStore(root: string, settings: StoreSettings): SessionStore {
  return createFilesStore(projectStateDir(root, settings.stateDir), settings);
}
