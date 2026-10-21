import { existsSync } from "node:fs";

import { ancestors } from "../liveness.js";
import type { SessionRecord } from "../types.js";

// Where a session hosted by pmcp-pty can be reached: the host's socket, the session id there,
// and the host instance, so a restarted host that reuses the id is never written to.
export interface PtyRef {
  readonly socket: string;
  readonly session: string;
  readonly instance: string;
}

// pmcp-pty sets PMCP_PTY_* in the child it spawns; a runtime started from that child's tool
// shell inherits them too. Only a runtime whose parent or grandparent is the host daemon
// (its pid leads the instance) is the hosted one; channel helpers are its siblings, not parents.
export function ptyFields(
  env: Readonly<Record<string, string | undefined>>,
  runtime: number,
  chain: (start: number, limit: number) => number[] = ancestors,
): { pty?: PtyRef } {
  const socket = env["PMCP_PTY_SOCKET"];
  const session = env["PMCP_PTY_SESSION"];
  const instance = env["PMCP_PTY_INSTANCE"];
  if (!socket || !session || !instance) return {};
  const daemon = Number(instance.split("-")[0]);
  if (!Number.isInteger(daemon) || daemon <= 1) return {};
  const above = chain(runtime, 3).slice(1, 3);
  return above.includes(daemon) ? { pty: { socket, session, instance } } : {};
}

export function ptyRef(record: SessionRecord): PtyRef | null {
  const pty = record["pty"] as Partial<PtyRef> | undefined;
  const ok =
    typeof pty?.socket === "string" &&
    typeof pty.session === "string" &&
    typeof pty.instance === "string";
  return ok ? (pty as PtyRef) : null;
}

// Wakeable through pmcp-pty while its socket is there; the host checks the instance on send.
export function ptyReachable(record: SessionRecord): boolean {
  const ref = ptyRef(record);
  return ref !== null && existsSync(ref.socket);
}
