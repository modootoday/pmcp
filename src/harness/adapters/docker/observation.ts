import type { DockerResource } from "../../contracts.js";
import { command } from "../process/command.js";
import { object } from "../../validation.js";
import { assertResourceOwner, configurationDigest } from "./claims.js";

export function inspectResource(
  resource: DockerResource,
  enforceConfiguration = true,
): Record<string, unknown> {
  const result = JSON.parse(command("docker", ["inspect", resource.id]));
  if (!Array.isArray(result) || result.length !== 1)
    throw new Error("invalid_container_inspection");
  const actual = object(result[0]);
  assertResourceOwner(resource, actual);
  if (
    enforceConfiguration &&
    configurationDigest(actual) !== resource.configurationDigest
  )
    throw new Error("container_configuration_changed");
  return actual;
}

export function resourceAbsent(error: unknown, id: string): boolean {
  const failure = error as Error & { stderr?: unknown };
  const message = String(failure.stderr).toLowerCase();
  return ["object", "container"].some((kind) =>
    message.includes(`no such ${kind}: ${id}`),
  );
}

export function assertResourceFresh(resource: DockerResource): void {
  const state = object(inspectResource(resource).State);
  if (state.Status !== "created" || state.Running !== false || state.Pid !== 0)
    throw new Error("container_requires_fresh_creation");
}

export function resourceRunning(resource: DockerResource): boolean {
  let actual: Record<string, unknown>;
  try {
    actual = inspectResource(resource);
  } catch (error) {
    if (resourceAbsent(error, resource.id)) return false;
    throw error;
  }
  const state = object(actual.State);
  if (typeof state.Running !== "boolean")
    throw new Error("unknown_container_lifecycle");
  return state.Running;
}
