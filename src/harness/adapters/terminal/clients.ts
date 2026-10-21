import type { Attacher, Backend } from "./backend.js";

export type AttachedClient = Attacher;

// Who is attached to a live session, as its pmcp-pty daemon reports it.
export function attachedClients(
  backend: Backend,
  sessionId: string,
): AttachedClient[] {
  const session = backend.inspect(sessionId);
  if (!session.alive) throw new Error("session_unavailable");
  return backend.attachers(sessionId);
}
