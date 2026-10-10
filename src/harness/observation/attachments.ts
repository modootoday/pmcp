import { attachedClients } from "../adapters/tmux/clients.js";
import type { GroupContext } from "../application/context.js";

export function inspectAttachments(context: GroupContext, sessionId: string) {
  context.store.session(sessionId);
  return { sessionId, clients: attachedClients(context.backend, sessionId) };
}
