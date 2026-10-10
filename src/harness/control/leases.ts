import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writableClients } from "../adapters/tmux/backend.js";
import type { GroupContext } from "../application/context.js";
import type { Lease, Receipt } from "../contracts.js";
import { privateJson, readPrivateJson } from "../groups/store.js";
import { id, object, text } from "../validation.js";

export function resolveLease(
  context: GroupContext,
  file: string,
  allowExpired = false,
): Lease {
  const credential = object(readPrivateJson(file));
  const lease = context.store.state.leases.find(
    (entry) => entry.token === credential.token,
  );
  if (!lease || lease.generation !== context.store.state.group.generation)
    throw new Error("stale_control");
  if (!Number.isFinite(Date.parse(lease.expiresAt)))
    throw new Error("invalid_control_expiry");
  if (!allowExpired && Date.parse(lease.expiresAt) <= Date.now())
    throw new Error("expired_control");
  context.store.session(lease.sessionId);
  context.backend.inspect(lease.sessionId);
  return lease;
}

export function acquireControl(
  context: GroupContext,
  sessionId: string,
  controller: string,
  mode: string,
): Receipt {
  const { store, backend } = context;
  if (store.state.group.state === "stopped") throw new Error("group_stopped");
  store.session(sessionId);
  const observation = backend.inspect(sessionId);
  if (!observation.alive) throw new Error("runtime_exited");
  const current = store.state.leases.find(
    (entry) => entry.sessionId === sessionId,
  );
  if (current && Date.parse(current.expiresAt) > Date.now())
    throw new Error("control_busy");
  if (writableClients(backend, observation.tmuxSessionId) > 0)
    throw new Error("native_writer_active");
  if (mode !== "cli" && mode !== "native")
    throw new Error("invalid_control_mode");
  const lease: Lease = {
    token: randomUUID(),
    sessionId,
    generation: store.state.group.generation,
    controller: id(controller, "controller"),
    mode,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  store.state.leases = store.state.leases.filter(
    (entry) => entry.sessionId !== sessionId,
  );
  store.state.leases.push(lease);
  store.save();
  const leaseFile = join(backend.runDirectory, `lease-${randomUUID()}.json`);
  privateJson(leaseFile, { token: lease.token });
  return { sessionId, controller, mode, expiresAt: lease.expiresAt, leaseFile };
}

export function controlOperation(
  context: GroupContext,
  action: string,
  leaseFile: string,
): Receipt {
  const lease = resolveLease(context, leaseFile, action === "release");
  if (action === "renew") {
    lease.expiresAt = new Date(Date.now() + 60_000).toISOString();
    context.store.save();
    return { sessionId: lease.sessionId, expiresAt: lease.expiresAt };
  }
  if (action !== "release") throw new Error("unsupported_control_operation");
  const session = context.backend.inspect(lease.sessionId);
  if (writableClients(context.backend, session.tmuxSessionId) > 0)
    throw new Error("native_writer_active");
  context.store.state.leases = context.store.state.leases.filter(
    (entry) => entry.token !== lease.token,
  );
  context.store.save();
  return { sessionId: lease.sessionId, released: true, inputReplayed: false };
}

export function attachment(
  context: GroupContext,
  sessionId: string,
  mode: string,
  leaseFile?: string,
): Receipt {
  context.store.session(sessionId);
  const session = context.backend.inspect(sessionId);
  if (!session.alive) throw new Error("runtime_exited");
  if (mode === "observe")
    return {
      socket: context.backend.socket,
      session: session.tmuxSessionId,
      readOnly: true,
    };
  if (mode !== "write") throw new Error("invalid_attach_mode");
  const lease = resolveLease(context, text(leaseFile, "lease_file"));
  if (lease.sessionId !== sessionId || lease.mode !== "native")
    throw new Error("native_control_required");
  if (writableClients(context.backend, session.tmuxSessionId) > 0)
    throw new Error("native_writer_active");
  return {
    socket: context.backend.socket,
    session: session.tmuxSessionId,
    readOnly: false,
  };
}
