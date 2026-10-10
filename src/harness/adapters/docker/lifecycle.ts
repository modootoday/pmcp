import type { DockerResource } from "../../contracts.js";
import { object } from "../../validation.js";
import { command } from "../process/command.js";
import { inspectResource, resourceAbsent } from "./observation.js";

export function stopResource(resource: DockerResource): void {
  let actual: Record<string, unknown>;
  try {
    actual = inspectResource(resource, false);
  } catch (error) {
    if (resourceAbsent(error, resource.id)) return;
    throw error;
  }
  const state = object(actual.State);
  if (state.Running === true)
    command("docker", ["stop", "--timeout", "2", resource.id]);
  if (object(inspectResource(resource, false).State).Running !== false)
    throw new Error("container_stop_unconfirmed");
  if (resource.managed) {
    command("docker", ["rm", resource.id]);
    try {
      inspectResource(resource, false);
    } catch (error) {
      if (resourceAbsent(error, resource.id)) return;
      throw error;
    }
    throw new Error("container_removal_unconfirmed");
  }
}
