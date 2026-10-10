import type { State } from "../contracts.js";
import { id, integer, object, strings, text } from "../validation.js";
import { dockerPolicy } from "../runtimes/docker-policy.js";

function member(value: unknown, allowed: readonly unknown[]): void {
  if (!allowed.includes(value)) throw new Error("invalid_state_value");
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 4096)
    throw new Error("invalid_state_collection");
  return value.map(object);
}

function unique(values: unknown[]): void {
  if (new Set(values).size !== values.length)
    throw new Error("duplicate_state_identity");
}

export function validateState(value: unknown): State {
  const state = object(value);
  const group = object(state.group);
  member(group.schemaVersion, [1]);
  for (const field of ["owner", "id", "generation"]) id(group[field], field);
  text(group.projectRoot, "project_root");
  strings(group.allowedRuntimes, "allowed_runtimes");
  member(group.profile, ["native", "docker"]);
  if (group.profile === "docker") dockerPolicy(group.dockerPolicy);
  if (group.profile === "native" && group.dockerPolicy !== undefined)
    throw new Error("docker_policy_requires_docker_profile");
  member(group.state, ["ready", "paused", "stopped"]);
  integer(group.memoryMb, "memory_budget", 128, 4096);
  integer(group.maxActive, "max_active", 1, 5);
  const sessions = records(group.sessions);
  for (const session of sessions) {
    id(session.id, "session_id");
    member(session.role, ["main", "worker"]);
    member(session.stopped, [true, false]);
  }
  unique(sessions.map((session) => session.id));
  if (sessions.filter((s) => s.role === "main" && !s.stopped).length > 1)
    throw new Error("multiple_active_main_sessions");
  const leases = records(state.leases);
  for (const lease of leases) {
    id(lease.token, "control_token");
    id(lease.controller, "controller");
    member(lease.generation, [group.generation]);
    member(lease.mode, ["cli", "native"]);
    member(
      lease.sessionId,
      sessions.map((session) => session.id),
    );
    if (!Number.isFinite(Date.parse(text(lease.expiresAt, "control_expiry"))))
      throw new Error("invalid_control_expiry");
  }
  unique(leases.map((lease) => lease.token));
  unique(leases.map((lease) => lease.sessionId));
  const deliveries = records(state.deliveries);
  for (const delivery of deliveries) {
    if (delivery.controller !== undefined)
      id(delivery.controller, "controller");
    id(delivery.requestId, "request_id");
    id(delivery.sessionId, "session_id");
    id(delivery.generation, "generation");
    member(delivery.operation, ["write", "submit"]);
    member(delivery.state, ["intent", "input_written", "delivery_uncertain"]);
    if (!/^[a-f0-9]{64}$/.test(text(delivery.digest, "delivery_digest")))
      throw new Error("invalid_delivery_digest");
  }
  unique(deliveries.map((delivery) => delivery.requestId));
  return state as unknown as State;
}
