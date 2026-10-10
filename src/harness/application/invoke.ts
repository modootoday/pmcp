import { serialized } from "../adapters/process/serialized.js";
import { attachNative } from "../adapters/tmux/attach.js";
import type { Operation, Receipt } from "../contracts.js";
import { createGroup } from "../groups/service.js";
import { listGroups } from "../groups/catalog.js";
import { capabilities, doctor } from "../capabilities/service.js";
import { watchSession } from "../observation/watch.js";
import { object } from "../validation.js";
import { runOperation } from "./dispatch.js";
import { isReadOnly } from "./effects.js";
import { releaseAttachmentControl } from "../control/maintenance.js";

function requireSuccess(receipt: Receipt): void {
  if (receipt.ok !== true)
    throw new Error(String(receipt.error ?? "operation_failed"));
}

async function openAttachment(operation: Operation): Promise<Receipt> {
  const spec = serialized(operation);
  requireSuccess(spec);
  if (spec.readOnly === true) return attachNative(spec);
  const renew = () =>
    requireSuccess(
      serialized({ ...operation, family: "control", action: "renew" }),
    );
  try {
    return await attachNative(spec, renew);
  } finally {
    requireSuccess(await releaseAttachmentControl(operation));
  }
}

export async function invoke(operation: Operation): Promise<Receipt> {
  if (operation.family === "capabilities")
    return { schemaVersion: 1, ok: true, ...capabilities() };
  if (operation.family === "doctor")
    return { schemaVersion: 1, ok: true, ...doctor() };
  if (operation.family === "group" && operation.action === "list")
    return { schemaVersion: 1, ok: true, ...listGroups() };
  if (operation.family === "group" && operation.action === "create") {
    return {
      schemaVersion: 1,
      ok: true,
      ...(await createGroup(object(operation.input))),
    };
  }
  if (operation.family === "attach" && operation.action === "open") {
    return { schemaVersion: 1, ok: true, ...(await openAttachment(operation)) };
  }
  if (operation.family === "session" && operation.action === "watch")
    return watchSession(operation);
  if (isReadOnly(operation)) {
    return { schemaVersion: 1, ok: true, ...(await runOperation(operation)) };
  }
  return serialized(operation);
}
