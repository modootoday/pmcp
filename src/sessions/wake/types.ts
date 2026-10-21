import type { SessionRecord } from "../types.js";

// What waking one session came to. Delivery of the mail itself stays with the hooks: a wake only
// starts a turn whose hooks then deliver it, so the mailbox remains the one source of truth.
export interface WakeResult {
  readonly session: string;
  readonly runtime: string;
  readonly outcome: "woken" | "not-wakeable" | "failed";
  readonly transport?: "claude-inbox" | "opencode-server" | "pmcp-pty";
  readonly detail: string;
  // The host's own reply for a pmcp-pty wake (turn outcome, channel, fallback reasons).
  readonly receipt?: Readonly<Record<string, unknown>>;
}

export interface WakeEnv {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  // How the woken session should run pmcp for this project (pmcpCommand); default pmcp.
  readonly pmcp?: string;
}

export interface Transport {
  // Whether this runtime's session can be woken, and through what, without sending anything.
  probe(record: SessionRecord, context: WakeEnv): string | null;
  wake(
    record: SessionRecord,
    text: string,
    context: WakeEnv,
  ): Promise<WakeResult>;
}
