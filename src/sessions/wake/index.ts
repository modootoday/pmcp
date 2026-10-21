import { addressedTo, inboxKey, sentBy } from "../mailbox/select.js";
import type { LiveRecord, Message, SessionStore } from "../types.js";
import { ptyRef } from "./pty-ref.js";
import type { Transport, WakeEnv, WakeResult } from "./types.js";

export type { WakeResult } from "./types.js";

// Outside pmcp-pty, Claude's inbox and opencode's server can start a turn in an idle session;
// every other runtime keeps next-event delivery. Transports load only to send; probe.ts
// answers whether a session is wakeable without them.
const TRANSPORTS: Readonly<Record<string, () => Promise<Transport>>> = {
  claude: async () => (await import("./claude.js")).claudeInbox,
  opencode: async () => (await import("./opencode.js")).opencodeServer,
};

function recipientOf(record: LiveRecord) {
  const roles = Array.isArray(record["roles"])
    ? (record["roles"] as string[])
    : [];
  return {
    key: inboxKey({ session: record.session }),
    session: record.session,
    ...(record.alias ? { alias: record.alias } : {}),
    roles,
    ...(record.worktree ? { desk: record.worktree } : {}),
    ...(record.startedAt ? { since: record.startedAt } : {}),
  };
}

// The short note a woken session reads; the bodies stay in the mailbox for its hooks to deliver.
export function wakeText(
  session: string,
  mail: readonly Message[],
  pmcp = "pmcp",
): string {
  const subjects = mail.map((message) => message.subject).filter(Boolean);
  const about = subjects.length > 0 ? ` (${subjects.join("; ")})` : "";
  // One exact command, so a woken runtime runs it instead of searching for how to read mail.
  return `pmcp mail: ${mail.length} new message(s) for you${about}. Run exactly this one command and follow what it prints, nothing else first: ${pmcp} sessions inbox --session ${session}`;
}

const NONE =
  "no wake transport for this runtime; the mail arrives at its next event";

// A session hosted by pmcp-pty is reached only through its host, which picks the channel;
// sessions outside it keep the runtime's own transport (Claude inbox, opencode server).
async function wakeOne(
  record: LiveRecord,
  text: string,
  context: WakeEnv,
): Promise<WakeResult> {
  if (ptyRef(record))
    return (await import("./pty.js")).ptyTurn(record, text, context);
  const load = TRANSPORTS[record.runtime ?? ""];
  if (load) return (await load()).wake(record, text, context);
  const runtime = record.runtime ?? "unknown";
  return {
    session: record.session,
    runtime,
    outcome: "not-wakeable",
    detail: NONE,
  };
}

// Wakes each live session the message is addressed to, once, and records each attempt.
export async function wakeRecipients(
  store: SessionStore,
  message: Message,
  context: WakeEnv,
): Promise<WakeResult[]> {
  const results: WakeResult[] = [];
  for (const record of store.registry.list().filter((entry) => entry.live)) {
    const recipient = recipientOf(record);
    if (!addressedTo(message, recipient) || sentBy(message, recipient))
      continue;
    const mail = store.mailbox.inbox(recipient);
    const text = wakeText(record.session, mail, context.pmcp);
    const result = await wakeOne(record, text, context);
    const receipt = (result.receipt?.["receipt"] ?? {}) as Record<
      string,
      unknown
    >;
    store.mailbox.record("woken", {
      id: message.id,
      to: recipient.key,
      outcome: result.outcome,
      transport: result.transport ?? null,
      ...(receipt["channel"] ? { channel: receipt["channel"] } : {}),
      detail: result.detail,
    });
    results.push(result);
  }
  return results;
}
