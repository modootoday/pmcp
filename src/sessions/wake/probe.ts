import type { LiveRecord } from "../types.js";
import { claudeSocket } from "./claude-socket.js";
import { opencodeUrl } from "./opencode-url.js";
import { ptyRef, ptyReachable } from "./pty-ref.js";
import type { WakeEnv } from "./types.js";

// Whether a live session can be woken, and through what. It loads no transport, so doctor and
// status, which the library entry reaches, stay free of network clients. A session hosted by
// pmcp-pty is reached only through its host.
export function wakeableBy(
  record: LiveRecord,
  context: WakeEnv,
): string | null {
  if (ptyRef(record)) return ptyReachable(record) ? "pmcp-pty" : null;
  if (record.runtime === "opencode")
    return opencodeUrl(record) ? "opencode-server" : null;
  if (record.runtime === "claude")
    return claudeSocket(record.session, context.home) ? "claude-inbox" : null;
  return null;
}
