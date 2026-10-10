import { randomUUID } from "node:crypto";
import {
  assertOwnedRecords,
  writableClients,
} from "../adapters/tmux/backend.js";
import { recoverInputLock } from "../adapters/process/recover-lock.js";
import { budgetOperation } from "../adapters/systemd/budget.js";
import type { GroupContext } from "../application/context.js";
import type { Receipt } from "../contracts.js";
import { listSessions } from "../observation/service.js";
import { startSession } from "../sessions/service.js";
import { inspectPendingStarts } from "../launch/service.js";
import { pendingLaunches, LaunchJournal } from "../launch/journal.js";
import { abortLaunch } from "../launch/recovery.js";
import { Connection } from "../adapters/tmux/connection.js";

export function inspectRecovery(
  context: GroupContext,
  includeStarts = false,
): Receipt {
  const pendingStarts = includeStarts ? inspectPendingStarts(context) : [];
  return {
    ...listSessions(context),
    control: context.store.state.leases.map(({ token, ...lease }) => ({
      ...lease,
      expired: Date.parse(lease.expiresAt) <= Date.now(),
    })),
    deliveries: context.store.state.deliveries,
    unregisteredOwnedSessions: context.backend
      .records()
      .filter(
        (record) =>
          !record.stoppedAt &&
          !context.store.state.group.sessions.some(
            (session) => session.id === record.id,
          ),
      )
      .map((record) => ({ id: record.id, runtime: record.runtime })),
    inputReplayed: false,
    ...(includeStarts ? { pendingStarts } : {}),
  };
}

export function abortStart(context: GroupContext, sessionId: string): Receipt {
  const records = context.backend.recordStore;
  const journal = new LaunchJournal(records, sessionId);
  if (
    !pendingLaunches(records).some((entry) => entry.id === sessionId) &&
    !journal.abortRecord()
  )
    throw new Error("start_already_committed");
  const result = abortLaunch(new Connection(records), journal);
  const reference = context.store.state.group.sessions.find(
    (session) => session.id === sessionId,
  );
  if (reference) reference.stopped = true;
  context.store.state.leases = context.store.state.leases.filter(
    (lease) => lease.sessionId !== sessionId,
  );
  context.store.save();
  return { ...result, sessionId };
}

export function reconcile(context: GroupContext): Receipt {
  const { store, backend } = context;
  for (const delivery of store.state.deliveries) {
    if (delivery.state === "intent") delivery.state = "delivery_uncertain";
  }
  store.save();
  assertOwnedRecords(backend);
  for (const session of store.state.group.sessions) {
    if (!session.stopped) recoverInputLock(backend, session.id);
  }
  const retained = [];
  for (const lease of store.state.leases) {
    if (Date.parse(lease.expiresAt) > Date.now()) {
      retained.push(lease);
      continue;
    }
    const session = backend.inspect(lease.sessionId);
    if (writableClients(backend, session.tmuxSessionId) > 0) {
      retained.push(lease);
    }
  }
  store.state.leases = retained;
  store.save();
  return inspectRecovery(context);
}

export async function stopOrphan(
  context: GroupContext,
  sessionId: string,
): Promise<Receipt> {
  if (
    context.store.state.group.sessions.some(
      (session) => session.id === sessionId,
    )
  )
    throw new Error("session_is_registered");
  assertOwnedRecords(context.backend);
  context.backend.inspect(sessionId);
  await budgetOperation(context.backend.runDirectory, {
    action: "stop",
    id: sessionId,
  });
  return { sessionId, stopped: true, adopted: false };
}

export async function replaceMain(
  context: GroupContext,
  input: Record<string, unknown>,
): Promise<Receipt> {
  const { store, backend } = context;
  const previous = store.state.group.sessions.find(
    (session) => session.role === "main" && !session.stopped,
  );
  if (previous) {
    const observation = backend.inspect(previous.id);
    if (observation.alive) throw new Error("main_still_alive");
    previous.stopped = true;
  }
  store.state.group.generation = randomUUID();
  store.state.leases = [];
  store.save();
  const result = await startSession(context, { ...input, role: "main" });
  return {
    ...result,
    previousMain: previous?.id ?? null,
    inputReplayed: false,
  };
}
