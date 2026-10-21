import type { Connection, Reply } from "./connection.js";
import { processIdentity } from "../process/identity.js";
import { integer, text } from "../../validation.js";
import type { LaunchIntent, LaunchProof } from "../../launch/contracts.js";

function labels(reply: Reply): Record<string, string> {
  return (reply["labels"] ?? {}) as Record<string, string>;
}

// Run inside the new session: pmcp-pty tells every child its socket, session and instance, and
// the spawn labelled the session with the owner, id and launch nonce, so the proof is checkable.
export function createProof(
  connection: Connection,
  intent: LaunchIntent,
): LaunchProof {
  const socket = text(process.env.PMCP_PTY_SOCKET, "native_host");
  if (socket !== intent.socket) throw new Error("foreign_native_socket");
  const ptySession = text(process.env.PMCP_PTY_SESSION, "native_session");
  const ptyInstance = text(process.env.PMCP_PTY_INSTANCE, "native_instance");
  const seen = connection.must({ op: "observe", id: ptySession, lines: 0 });
  const tags = labels(seen);
  if (
    seen["instance"] !== ptyInstance ||
    tags["pmcp.owner"] !== intent.owner ||
    tags["pmcp.session"] !== intent.id ||
    tags["pmcp.launch"] !== intent.nonce
  )
    throw new Error("foreign_launch_pane");
  return {
    nonce: intent.nonce,
    runnerIdentity: processIdentity(process.pid),
    session: {
      id: intent.id,
      owner: intent.owner,
      socket: intent.socket,
      runtime: intent.runtime,
      cwd: intent.cwd,
      memoryMb: intent.memoryMb,
      ptySession,
      ptyInstance,
      pid: integer(
        Number(seen["pid"]),
        "session_process",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      unit: intent.unit,
      createdAt: intent.createdAt,
      ...(intent.resource ? { resource: intent.resource } : {}),
    },
  };
}

export function assertProof(connection: Connection, proof: LaunchProof): void {
  const record = proof.session;
  const seen = connection.must({
    op: "observe",
    id: record.ptySession,
    lines: 0,
  });
  if (seen["instance"] !== record.ptyInstance)
    throw new Error("stale_launch_server");
  if (Number(seen["pid"]) !== record.pid) throw new Error("stale_launch_pane");
  const tags = labels(seen);
  if (
    tags["pmcp.owner"] !== record.owner ||
    tags["pmcp.session"] !== record.id ||
    tags["pmcp.launch"] !== proof.nonce
  )
    throw new Error("foreign_launch_pane");
}

// Whether the proven session is still in this daemon; a different instance is a different host.
export function panePresent(
  connection: Connection,
  proof: LaunchProof,
): boolean {
  if (!connection.alive()) return false;
  const listed = connection.must({ op: "list" });
  if (listed["instance"] !== proof.session.ptyInstance)
    throw new Error("stale_launch_server");
  const sessions = (listed["sessions"] ?? []) as Reply[];
  return sessions.some((s) => s["id"] === proof.session.ptySession);
}
