import type { GroupContext } from "../../application/context.js";
import type { Receipt } from "../../contracts.js";

export function detachClients(
  context: GroupContext,
  sessionId: string,
): Receipt {
  context.store.session(sessionId);
  const detached = context.backend.detach(sessionId);
  return {
    sessionId,
    clientsDetached: true,
    detached,
    runtimeStopRequested: false,
  };
}
