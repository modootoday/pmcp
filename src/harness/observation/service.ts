import type { GroupContext } from "../application/context.js";
import type { Receipt } from "../contracts.js";
import { readOptions } from "./options.js";

export function listSessions(context: GroupContext): Receipt {
  const { store, backend } = context;
  const sessions = store.state.group.sessions.map((reference) => {
    if (reference.stopped) return { ...reference, observed: "stopped" };
    try {
      return {
        ...backend.inspect(reference.id),
        role: reference.role,
        observed: "terminal-process",
      };
    } catch (error) {
      return {
        ...reference,
        observed: "unavailable",
        reason: error instanceof Error ? error.message : "observation_failed",
      };
    }
  });
  return {
    generation: store.state.group.generation,
    sessions,
    providerStateInferred: false,
  };
}

export function observeSession(
  context: GroupContext,
  action: string,
  sessionId: string,
  input?: Record<string, unknown>,
): Receipt {
  context.store.session(sessionId);
  if (action === "inspect") {
    return {
      session: context.backend.inspect(sessionId),
      providerStateInferred: false,
    };
  }
  if (action !== "read") throw new Error("unsupported_observation_operation");
  return {
    sessionId,
    ...context.backend.read(sessionId, readOptions(input)),
    providerStateInferred: false,
  };
}

export function inspectDeliveries(
  context: GroupContext,
  requestId?: string,
): Receipt {
  const deliveries = context.store.state.deliveries.filter(
    (entry) => !requestId || entry.requestId === requestId,
  );
  if (requestId && deliveries.length === 0)
    throw new Error("request_not_found");
  return {
    generation: context.store.state.group.generation,
    deliveries,
    processingConfirmed: false,
  };
}
