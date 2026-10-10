import type { Operation, Receipt } from "../contracts.js";
import {
  acquireControl,
  attachment,
  controlOperation,
} from "../control/leases.js";
import { deliver, interrupt } from "../delivery/service.js";
import { groupOperation } from "../groups/service.js";
import {
  inspectDeliveries,
  listSessions,
  observeSession,
} from "../observation/service.js";
import {
  inspectRecovery,
  reconcile,
  replaceMain,
  stopOrphan,
  abortStart,
} from "../recovery/service.js";
import { startSession, stopSession } from "../sessions/service.js";
import { object, text } from "../validation.js";
import { openGroup } from "./context.js";
import { isReadOnly } from "./effects.js";
import { detachClients } from "../adapters/tmux/detach.js";
import { inspectAttachments } from "../observation/attachments.js";

export async function runOperation(operation: Operation): Promise<Receipt> {
  const context = openGroup(text(operation.groupFile, "group_file"));
  if (
    !isReadOnly(operation) &&
    operation.generation !== context.store.state.group.generation
  ) {
    throw new Error("stale_group_generation");
  }
  const { family, action } = operation;
  if (family === "group")
    return groupOperation(context, action, operation.input);
  if (family === "session") {
    if (action === "start")
      return startSession(context, object(operation.input));
    if (action === "list") return listSessions(context);
    const sessionId = text(operation.sessionId, "session_id");
    if (action === "stop") return stopSession(context, sessionId);
    return observeSession(context, action, sessionId, operation.input);
  }
  if (family === "control") {
    if (action === "acquire") {
      return acquireControl(
        context,
        text(operation.sessionId, "session_id"),
        text(operation.controller, "controller"),
        operation.mode ?? "cli",
      );
    }
    return controlOperation(
      context,
      action,
      text(operation.leaseFile, "lease_file"),
    );
  }
  if (family === "input") {
    const leaseFile = text(operation.leaseFile, "lease_file");
    if (action === "interrupt") return interrupt(context, leaseFile);
    return deliver(
      context,
      action,
      leaseFile,
      text(operation.requestId, "request_id"),
      operation.text ?? "",
    );
  }
  if (family === "attach") {
    if (action === "inspect")
      return inspectAttachments(
        context,
        text(operation.sessionId, "session_id"),
      );
    if (action === "detach")
      return detachClients(context, text(operation.sessionId, "session_id"));
    return attachment(
      context,
      text(operation.sessionId, "session_id"),
      operation.mode ?? "observe",
      operation.leaseFile,
    );
  }
  if (family === "delivery")
    return inspectDeliveries(context, operation.requestId);
  if (family === "recovery") {
    if (action === "abort-start")
      return abortStart(context, text(operation.sessionId, "session_id"));
    if (action === "inspect")
      return inspectRecovery(context, operation.includeStarts === true);
    if (action === "reconcile") return reconcile(context);
    if (action === "stop-orphan")
      return stopOrphan(context, text(operation.sessionId, "session_id"));
    if (action === "replace-main")
      return replaceMain(context, object(operation.input));
  }
  throw new Error("unsupported_operation");
}
