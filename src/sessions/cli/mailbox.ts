import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import {
  ArgumentError,
  many,
  one,
  type CommandContext,
} from "../../cli/command.js";
import { inferSession } from "../identity.js";
import { ancestors } from "../liveness.js";
import { inboxKey, normalizeSelector } from "../mailbox/select.js";
import { isOperator } from "../operator-cli.js";
import { pmcpCommand } from "../projector-cli.js";
import type { Message, Recipient, SessionStore } from "../types.js";
import { wakeRecipients } from "../wake/index.js";
import { storeFrom } from "./verbs.js";

const OPERATOR = "operator";

function mailboxOf(context: CommandContext): SessionStore {
  const { store } = storeFrom(context);
  if (!store.mailbox.settings.enabled)
    throw new ArgumentError(
      "the mailbox is off; declare [sessions.mailbox] in pmcp.toml",
    );
  return store;
}

// --session, else --by, else the session this command runs inside, else the operator, who must
// pass the operator check: inside a runtime whose session cannot be found, ask for --session.
function sessionOf(
  context: CommandContext,
  store: SessionStore,
): string | undefined {
  const given = one(context.args, "session");
  if (given || one(context.args, "by")) return given;
  const found = inferSession(context.env, store.registry.list(), ancestors());
  if (!found.session && found.runtime)
    throw new ArgumentError(
      `running inside ${found.runtime} but its session is unknown; pass --session <id> (the id is in the mailbox notice) or --by <name>`,
    );
  return found.session;
}

function aliasOf(
  context: CommandContext,
  session: string | undefined,
  own: string | undefined,
): string | undefined {
  const by = one(context.args, "by");
  if (by !== undefined && by !== OPERATOR) return by;
  if (by === undefined && (session || own)) return own;
  if (isOperator(context)) return OPERATOR;
  throw new ArgumentError(
    by === OPERATOR
      ? "--by operator is for the operator's own terminal; name yourself with --by <name>"
      : "say who you are with --session <id> or --by <name>: no agent session or operator terminal was found",
  );
}

function caller(context: CommandContext, store: SessionStore): Recipient {
  const session = sessionOf(context, store);
  const record = session ? store.registry.get(session) : null;
  const alias = aliasOf(context, session, record?.alias);
  const roles = Array.isArray(record?.["roles"])
    ? (record["roles"] as string[])
    : [];
  return {
    key: inboxKey({
      ...(session ? { session } : {}),
      ...(alias ? { alias } : {}),
    }),
    ...(session ? { session } : {}),
    ...(alias ? { alias } : {}),
    roles,
    ...(record?.worktree ? { worktree: record.worktree } : {}),
    ...(record?.startedAt ? { since: record.startedAt } : {}),
  };
}

// The body is the words after the verb (and id), or stdin when given as -.
function bodyOf(context: CommandContext, skip: number): string {
  const words = context.args.positional.slice(skip);
  const body = (
    words.length === 1 && words[0] === "-"
      ? readFileSync(0, "utf8")
      : words.join(" ")
  ).trim();
  if (!body)
    throw new ArgumentError("the message needs a body (words, or - for stdin)");
  return body;
}

function ttlOf(context: CommandContext): number | undefined {
  const raw = one(context.args, "ttl");
  if (raw === undefined) return undefined;
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes <= 0)
    throw new ArgumentError("--ttl takes a positive number of minutes");
  return minutes;
}

function print(context: CommandContext, value: unknown, line: string): void {
  if (context.args.flags.has("json"))
    context.ui.data(`${JSON.stringify(value, null, 2)}\n`);
  else context.ui.results.line(line);
}

async function sent(
  context: CommandContext,
  store: SessionStore,
  to: string[],
  replyTo?: string,
): Promise<number> {
  const me = caller(context, store);
  const subject = one(context.args, "subject");
  const ttlMinutes = ttlOf(context);
  const message = store.mailbox.send({
    from: {
      ...(me.session ? { session: me.session } : {}),
      ...(me.alias ? { alias: me.alias } : {}),
    },
    to,
    body: bodyOf(context, replyTo ? 2 : 1),
    ...(subject ? { subject } : {}),
    ...(ttlMinutes ? { ttlMinutes } : {}),
    ...(replyTo ? { replyTo } : {}),
    once: context.args.flags.has("once"),
  });
  const wanted =
    context.args.flags.has("wake") || store.mailbox.settings.wake === true;
  const home = context.env["HOME"] ?? homedir();
  const woken = wanted
    ? await wakeRecipients(store, message, {
        home,
        env: context.env,
        pmcp: pmcpCommand(
          storeFrom(context).root,
          store.dir,
          context.env["PATH"],
        ),
      })
    : [];
  const lines = woken.map(
    (result) =>
      `wake ${result.session.slice(0, 8)} (${result.runtime}) via ${result.transport ?? "none"}: ${result.outcome}; ${result.detail}`,
  );
  print(
    context,
    wanted ? { ...message, wake: woken } : message,
    [`sent ${message.id} to ${message.to.join(", ")}`, ...lines].join("\n"),
  );
  return 0;
}

export function send(context: CommandContext): Promise<number> {
  const store = mailboxOf(context);
  const to = many(context.args, "to").map((selector) =>
    normalizeSelector(selector, context.cwd),
  );
  if (to.length === 0)
    throw new ArgumentError("pmcp sessions send needs --to <selector>");
  return sent(context, store, to, one(context.args, "reply-to"));
}

export function reply(context: CommandContext): Promise<number> {
  const store = mailboxOf(context);
  const id = context.args.positional[1];
  const original = id ? store.mailbox.get(id) : null;
  if (!original) throw new ArgumentError(`no message ${id ?? ""} to reply to`);
  const { session, alias } = original.from;
  const to = session
    ? [`session:${session}`]
    : [`alias:${alias ?? "operator"}`];
  return sent(context, store, to, original.id);
}

const sender = (message: Message) =>
  message.from.alias ?? message.from.session?.slice(0, 8) ?? "unknown";

export function inbox(context: CommandContext): number {
  const store = mailboxOf(context);
  const me = caller(context, store);
  const all = context.args.flags.has("all");
  const messages = all ? store.mailbox.list() : store.mailbox.inbox(me);
  const rows = messages.map((message) => ({
    ...message,
    acked: store.mailbox.acked(me.key, message.id),
  }));
  if (context.args.flags.has("json")) {
    context.ui.data(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  if (rows.length === 0) context.ui.results.line("no messages");
  for (const row of rows) {
    const subject = row.subject ? ` (${row.subject})` : "";
    const once = row.once ? " [once]" : "";
    context.ui.results.line(
      `${row.id} from ${sender(row)} to ${row.to.join(", ")}${subject}${once}: ${row.body}`,
    );
  }
  return 0;
}

export function ack(context: CommandContext): number {
  const store = mailboxOf(context);
  const ids = context.args.positional.slice(1);
  if (ids.length === 0)
    throw new ArgumentError("pmcp sessions ack needs message ids");
  const done = store.mailbox.ack(caller(context, store).key, ids);
  const missing = ids.filter((id) => !done.includes(id));
  print(
    context,
    { acked: done, missing },
    `acknowledged ${done.length}${missing.length ? `; unknown: ${missing.join(", ")}` : ""}`,
  );
  return missing.length > 0 ? 1 : 0;
}
