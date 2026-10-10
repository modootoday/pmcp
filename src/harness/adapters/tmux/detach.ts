import type { GroupContext } from "../../application/context.js";
import type { Receipt } from "../../contracts.js";

export function detachClients(
  context: GroupContext,
  sessionId: string,
): Receipt {
  context.store.session(sessionId);
  const session = context.backend.inspect(sessionId);
  context.backend.tmux(["detach-client", "-s", session.tmuxSessionId]);
  return { sessionId, clientsDetached: true, runtimeStopRequested: false };
}
