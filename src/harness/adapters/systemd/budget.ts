import { join } from "node:path";
import type { Receipt } from "../../contracts.js";
import { privateJson, readPrivateJson } from "../../groups/store.js";
import { integer, object, text } from "../../validation.js";
import { openBackend } from "../tmux/backend.js";
import { budgetSlice } from "../tmux/records.js";
import { command } from "../process/command.js";
import { unitActive } from "./units.js";
import { resourceRunning } from "../docker/observation.js";
import { resourceClaim } from "../docker/claims.js";
import type { DockerPreparation } from "../docker/creation-plan.js";

export async function budgetOperation(
  directory: string,
  operation: Record<string, unknown>,
): Promise<Receipt> {
  const backend = openBackend(directory);
  const path = join(directory, "runtime-policy.json");
  const metadata = object(readPrivateJson(backend.metadataPath));
  const slice = budgetSlice(backend.owner);
  if (operation.action === "configure") {
    if (metadata.budgetSlice || backend.records().length)
      throw new Error("budget_already_initialized");
    const memoryMb = integer(operation.memoryMb, "memory_budget", 128, 4096);
    const maxActive = integer(operation.maxActive, "max_active", 1, 5);
    privateJson(backend.metadataPath, { ...metadata, budgetSlice: slice });
    privateJson(path, { owner: backend.owner, slice, memoryMb, maxActive });
    command("systemctl", ["--user", "start", slice]);
    command("systemctl", [
      "--user",
      "set-property",
      "--runtime",
      slice,
      `MemoryMax=${memoryMb}M`,
      `MemoryHigh=${Math.floor(memoryMb * 0.8)}M`,
      "TasksMax=256",
      "CPUQuota=100%",
    ]);
    return { ok: true };
  }
  const policy = object(readPrivateJson(path));
  if (
    policy.owner !== backend.owner ||
    metadata.budgetSlice !== slice ||
    policy.slice !== slice
  )
    throw new Error("foreign_budget_policy");
  if (operation.action === "cleanup") {
    backend.cleanup();
    command("systemctl", ["--user", "stop", slice]);
    command("systemctl", ["--user", "revert", slice]);
    return { ok: true, budgetStopped: true };
  }
  if (operation.action === "stop") {
    backend.stop(text(operation.id, "session_id"));
    return { ok: true, stopped: true };
  }
  if (operation.action !== "start") throw new Error("invalid_budget_operation");
  const active = backend.records().filter((record) => {
    if (
      record.resource &&
      resourceRunning(record.resource) &&
      !backend.inspect(record.id).alive
    )
      throw new Error("container_running_without_proxy");
    if (record.stoppedAt) {
      if (unitActive(record.unit)) throw new Error("runtime_stop_unconfirmed");
      return false;
    }
    const observation = backend.inspect(record.id);
    if (!observation.alive && unitActive(record.unit))
      throw new Error("runtime_lifecycle_uncertain");
    return observation.alive;
  });
  if (active.length >= integer(policy.maxActive, "max_active", 1, 5))
    throw new Error("runtime_capacity_exceeded");
  const spec = object(operation.spec);
  const memoryMb = integer(spec.memoryMb, "session_memory", 32, 1536);
  const resource =
    spec.resource === undefined
      ? undefined
      : resourceClaim(spec.resource, backend.owner);
  const dockerPreparation = spec.dockerPreparation as
    DockerPreparation | undefined;
  const cpuQuota = resource?.cpuQuota ?? dockerPreparation?.cpuQuota;
  if (cpuQuota !== undefined) {
    const reservedCpu = backend
      .records()
      .filter((record) => !record.stoppedAt)
      .reduce((total, record) => total + (record.resource?.cpuQuota ?? 0), 0);
    if (reservedCpu + cpuQuota > 50000)
      throw new Error("aggregate_container_cpu_budget_exceeded");
  }
  if (
    active.reduce((total, session) => total + session.memoryMb, 0) + memoryMb >
    integer(policy.memoryMb, "memory_budget", 128, 4096)
  )
    throw new Error("aggregate_memory_budget_exceeded");
  if (resource || dockerPreparation)
    command("systemctl", [
      "--user",
      "set-property",
      "--runtime",
      slice,
      "CPUQuota=50%",
    ]);
  const session = await backend.start({
    runtime: text(spec.runtime, "runtime"),
    argv: spec.argv as string[],
    cwd: text(spec.cwd, "cwd"),
    memoryMb,
    budgetSlice: slice,
    groupId: text(spec.groupId, "group_id"),
    generation: text(spec.generation, "generation"),
    role: spec.role as "main" | "worker",
    ...(resource ? { resource } : {}),
    ...(dockerPreparation ? { dockerPreparation } : {}),
  });
  return { ok: true, session };
}
