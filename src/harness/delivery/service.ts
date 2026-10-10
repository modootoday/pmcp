import { createHash } from "node:crypto";
import { writableClients } from "../adapters/tmux/backend.js";
import type { GroupContext } from "../application/context.js";
import type { Delivery, Receipt } from "../contracts.js";
import { resolveLease } from "../control/leases.js";
import { id } from "../validation.js";

export function deliver(
  context: GroupContext,
  operation: string,
  leaseFile: string,
  requestId: string,
  text: string,
): Receipt {
  const { store, backend } = context;
  const lease = resolveLease(context, leaseFile);
  if (lease.mode !== "cli") throw new Error("native_control_held");
  const session = backend.inspect(lease.sessionId);
  if (writableClients(backend, session.tmuxSessionId) > 0)
    throw new Error("native_writer_active");
  if (operation !== "write" && operation !== "submit")
    throw new Error("unsupported_input_operation");
  if (operation === "submit" && text !== "")
    throw new Error("submit_does_not_accept_text");
  backend.validateText(text);
  if (/[\r\n\t]/.test(text))
    throw new Error("unqualified_terminal_control_input");
  id(requestId, "request_id");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        operation,
        text,
        sessionId: lease.sessionId,
        generation: lease.generation,
      }),
    )
    .digest("hex");
  const previous = store.state.deliveries.find(
    (entry) => entry.requestId === requestId,
  );
  if (previous) {
    if (previous.digest !== digest) throw new Error("request_conflict");
    return {
      ...previous,
      ok: previous.state === "input_written",
      duplicate: true,
      resendAllowed: false,
      processingConfirmed: false,
    };
  }
  if (
    store.state.deliveries.some(
      (entry) =>
        entry.sessionId === lease.sessionId && entry.state !== "input_written",
    )
  ) {
    throw new Error("session_delivery_uncertain");
  }
  const delivery: Delivery = {
    controller: lease.controller,
    requestId,
    sessionId: lease.sessionId,
    generation: lease.generation,
    digest,
    operation,
    state: "intent",
  };
  store.state.deliveries.push(delivery);
  store.save();
  try {
    const receipt = backend.write(lease.sessionId, text, {
      submit: operation === "submit",
    });
    delivery.state = "input_written";
    store.save();
    return {
      ...receipt,
      requestId,
      generation: lease.generation,
      resendAllowed: false,
    };
  } catch (error) {
    delivery.state = "delivery_uncertain";
    store.save();
    throw error;
  }
}

export function interrupt(context: GroupContext, leaseFile: string): Receipt {
  const lease = resolveLease(context, leaseFile);
  if (lease.mode !== "cli") throw new Error("native_control_held");
  const session = context.backend.inspect(lease.sessionId);
  if (writableClients(context.backend, session.tmuxSessionId) > 0)
    throw new Error("native_writer_active");
  context.backend.interrupt(lease.sessionId);
  return {
    sessionId: lease.sessionId,
    signal: "terminal-interrupt",
    processingConfirmed: false,
  };
}
