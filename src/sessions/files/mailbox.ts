import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { asMessage } from "../mailbox/format.js";
import { addressedTo, sentBy } from "../mailbox/select.js";
import type { Mailbox, MailboxSettings, Message } from "../types.js";
import { readJson } from "./json.js";

const ID = /^\d{13}-[0-9a-f]{8}$/u;
const SAFE_KEY = /^@?[\w.-]+$/u;

// <state>/messages/<id>.json is created once and never rewritten; per-recipient state lives in
// empty markers under <state>/inbox/<key>/, and <state>/messages.jsonl is an append-only audit.
export function filesMailbox(dir: string, settings: MailboxSettings): Mailbox {
  const messages = join(dir, "messages");
  const inbox = join(dir, "inbox");
  const pathOf = (id: string) => join(messages, `${id}.json`);
  const marker = (key: string, id: string, kind: "ack" | "delivered") => {
    if (!SAFE_KEY.test(key) || !ID.test(id))
      throw new Error(`invalid mailbox key ${key} or id ${id}`);
    return join(inbox, key, `${id}.${kind}`);
  };
  const audit = (event: string, fields: Record<string, unknown>) => {
    if (!settings.audit) return;
    const line = { at: new Date().toISOString(), event, ...fields };
    // One small append per event: O_APPEND keeps concurrent lines whole.
    appendFileSync(join(dir, "messages.jsonl"), `${JSON.stringify(line)}\n`, {
      mode: 0o600,
    });
  };
  const touch = (path: string) => {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, "", { flag: "wx", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  };
  const get = (id: string) =>
    ID.test(id) ? asMessage(readJson(pathOf(id))) : null;
  const all = (): Message[] =>
    existsSync(messages)
      ? readdirSync(messages)
          .filter((name) => name.endsWith(".json"))
          .map((name) => get(name.slice(0, -5)))
          .filter((message): message is Message => message !== null)
          .sort((a, b) => a.id.localeCompare(b.id))
      : [];
  const live = (now: number) =>
    all().filter((message) => Date.parse(message.expiresAt) > now);
  const acked = (key: string, id: string) => existsSync(marker(key, id, "ack"));
  const remove = (message: Message, event: string) => {
    rmSync(pathOf(message.id), { force: true });
    if (existsSync(inbox))
      for (const key of readdirSync(inbox))
        for (const kind of ["ack", "delivered"])
          rmSync(join(inbox, key, `${message.id}.${kind}`), { force: true });
    audit(event, { id: message.id });
  };

  return {
    settings,
    send(input) {
      mkdirSync(messages, { recursive: true, mode: 0o700 });
      const created = Date.now();
      const ttl = input.ttlMinutes ?? settings.ttlMinutes;
      for (let attempt = 0; ; attempt += 1) {
        if (attempt === 8)
          throw new Error(`could not create a message in ${messages}`);
        const id = `${created}-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;
        const message: Message = {
          id,
          from: input.from,
          to: [...input.to],
          ...(input.subject ? { subject: input.subject } : {}),
          body: input.body,
          createdAt: new Date(created).toISOString(),
          expiresAt: new Date(created + ttl * 60_000).toISOString(),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          once: input.once === true,
          ...(input.broadcastId ? { broadcastId: input.broadcastId } : {}),
        };
        const temporary = `${pathOf(id)}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(message, null, 2)}\n`, {
          mode: 0o600,
        });
        try {
          // link refuses an existing name, so a message file is never replaced.
          linkSync(temporary, pathOf(id));
        } catch {
          continue;
        } finally {
          unlinkSync(temporary);
        }
        audit("sent", { id, from: input.from, to: message.to });
        return message;
      }
    },
    get,
    list: (now = Date.now()) => live(now),
    inbox: (recipient, now = Date.now()) =>
      live(now).filter(
        (message) =>
          addressedTo(message, recipient) &&
          !sentBy(message, recipient) &&
          !acked(recipient.key, message.id),
      ),
    delivered: (key, id) => existsSync(marker(key, id, "delivered")),
    markDelivered(key, ids) {
      for (const id of ids)
        if (touch(marker(key, id, "delivered")))
          audit("delivered", { id, to: key });
    },
    acked,
    ack(key, ids) {
      const done = ids.filter((id) => get(id) !== null);
      for (const id of done)
        if (touch(marker(key, id, "ack"))) audit("acked", { id, by: key });
      return done;
    },
    withdraw(match) {
      const gone = all().filter(match);
      for (const message of gone) remove(message, "withdrawn");
      return gone.length;
    },
    sweep(now = Date.now()) {
      const expired = all().filter(
        (message) => Date.parse(message.expiresAt) <= now,
      );
      for (const message of expired) remove(message, "expired");
      return expired.length;
    },
    record: (event, fields) => audit(event, fields),
  };
}
