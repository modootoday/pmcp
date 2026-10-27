// Preserve state field names so existing coordination readers remain compatible.

export interface TouchedPath {
  readonly path: string;
  readonly at: string;
}

export interface SessionRecord {
  readonly session: string;
  readonly startedAt?: string;

  readonly updatedAt?: string;
  readonly pid?: number;
  readonly runtime?: string;
  readonly alias?: string;
  readonly cwd?: string;
  readonly worktree?: string;
  readonly branch?: string;
  readonly status?: "idle" | "working" | "waiting";
  readonly waiting?: string;
  readonly source?: string;
  readonly lastAction?: string;
  readonly lastMessage?: string;
  readonly seenBroadcast?: string;
  readonly stopNoticeTurn?: string;
  readonly sharedRoot?: string;
  readonly sharedTouched?: readonly TouchedPath[];
  readonly sharedEditNoticed?: boolean;
  readonly sharedNoticed?: string;
  readonly sharedWarned?: boolean;
  readonly [key: string]: unknown;
}

export interface LiveRecord extends SessionRecord {
  readonly live: boolean;
}

export interface Pause {
  readonly by: string;
  readonly reason: string;
  readonly since: string;
}

export interface Lease {
  readonly pid: number;
  readonly subject: string;
  readonly cwd?: string;
  readonly since: string;
}

export interface Broadcast {
  readonly id: string;
  readonly by: string;
  readonly text: string;
  readonly since: string;
}

export interface SessionStore {
  readonly dir: string;
  readonly registry: {
    get(session: string): SessionRecord | null;

    upsert(
      session: string,
      fields: Partial<SessionRecord>,
    ): SessionRecord | null;
    list(now?: number): LiveRecord[];
    remove(session: string): void;

    sweep(now?: number): number;
  };
  readonly pause: {
    read(): Pause | null;
    write(pause: { by: string; reason: string } | null): void;
  };
  readonly leases: {
    read(name: string): Lease | null;
    take(
      name: string,
      lease: { subject: string; cwd?: string; pid?: number },
    ): boolean;
    release(name: string, pid?: number): void;
  };
  readonly broadcast: {
    list(): Broadcast[];

    unseen(session: string): Broadcast[];
    post(broadcast: { by: string; text: string }): Broadcast;
    clear(): void;
  };
  readonly mailbox: Mailbox;
}

export interface MessageFrom {
  readonly session?: string;
  readonly alias?: string;
}

// One file per message, never rewritten; acks and deliveries are separate markers.
export interface Message {
  readonly id: string;
  readonly from: MessageFrom;
  // Selectors: all, session:<id>, alias:<name>, role:<name>, worktree:<path> (alias desk:<path>).
  readonly to: readonly string[];
  readonly subject?: string;
  readonly body: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly replyTo?: string;
  readonly once: boolean;
  // Set when the message carries a broadcast, so broadcast.json readers stay in step.
  readonly broadcastId?: string;
}

export interface Recipient {
  // The inbox key: a session id, or @<alias> for someone outside a session.
  readonly key: string;
  readonly session?: string;
  readonly alias?: string;
  readonly roles?: readonly string[];
  readonly worktree?: string;
  // When the session started: a broadcast to all sent before then is not for it.
  readonly since?: string;
}

export interface MailboxSettings {
  readonly enabled: boolean;
  readonly ttlMinutes: number;
  readonly maxDelivered: number;
  readonly audit: boolean;
  // Wake idle recipients on send where their runtime allows it (Claude inbox, opencode server).
  readonly wake?: boolean;
}

export interface SendInput {
  readonly from: MessageFrom;
  readonly to: readonly string[];
  readonly body: string;
  readonly subject?: string;
  readonly ttlMinutes?: number;
  readonly replyTo?: string;
  readonly once?: boolean;
  readonly broadcastId?: string;
}

export interface Mailbox {
  readonly settings: MailboxSettings;
  send(input: SendInput): Message;
  get(id: string): Message | null;
  // Unexpired messages, oldest first.
  list(now?: number): Message[];
  // Unexpired, unacked messages addressed to the recipient and not sent by it.
  inbox(recipient: Recipient, now?: number): Message[];
  delivered(key: string, id: string): boolean;
  markDelivered(key: string, ids: readonly string[]): void;
  acked(key: string, id: string): boolean;
  ack(key: string, ids: readonly string[]): string[];
  withdraw(match: (message: Message) => boolean): number;
  sweep(now?: number): number;
  // Appends an audit line for something done outside the store, such as a wake.
  record(event: string, fields: Readonly<Record<string, unknown>>): void;
}
