import { existsSync } from "node:fs";
import {
  processIdentity,
  controllerExited,
} from "../adapters/process/identity.js";
import { Connection } from "../adapters/tmux/connection.js";
import { assertProof } from "../adapters/tmux/launch-identity.js";
import { unitActive } from "../adapters/systemd/units.js";
import type { GroupContext } from "../application/context.js";
import type { Receipt } from "../contracts.js";
import type { RecordStore } from "../adapters/tmux/records.js";
import { LaunchJournal, launchJournals, pendingLaunches } from "./journal.js";
import { assertResourceFresh } from "../adapters/docker/observation.js";

export function assertLaunchAdmission(records: RecordStore): void {
  for (const journal of launchJournals(records)) {
    if (
      journal.abortRecord()?.state === "stopped" &&
      unitActive(journal.intent().unit)
    )
      throw new Error("runtime_stop_unconfirmed");
  }
  if (pendingLaunches(records).length)
    throw new Error("launch_requires_reconciliation");
}

export function authorizeSession(
  context: GroupContext,
  sessionId: string,
): void {
  const journal = new LaunchJournal(context.backend.recordStore, sessionId);
  if (journal.intent().controllerIdentity !== processIdentity(process.pid))
    throw new Error("foreign_launch_controller");
  assertProof(new Connection(context.backend.recordStore), journal.proof());
  const resource = journal.intent().resource;
  if (resource) assertResourceFresh(resource);
  journal.authorize();
  journal.commit();
}

export function inspectPendingStarts(context: GroupContext): Receipt[] {
  return pendingLaunches(context.backend.recordStore).map((journal) => ({
    sessionId: journal.id,
    role: journal.intent().role,
    runtime: journal.intent().runtime,
    controllerExited: controllerExited(journal.intent().controllerIdentity),
    proofPresent: existsSync(journal.path("proof")),
    recordPresent: existsSync(journal.records.path(journal.id)),
    registered: context.store.state.group.sessions.some(
      (session) => session.id === journal.id,
    ),
    authorizationPresent: existsSync(journal.path("grant")),
    processingConfirmed: false,
    inputReplayed: false,
  }));
}
