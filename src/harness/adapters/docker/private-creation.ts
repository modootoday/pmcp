import type { Group } from "../../contracts.js";
import type { DockerCreation } from "./creation-plan.js";
import { selectedProfile } from "../../runtimes/private-profiles.js";
import { assertProfileAvailable } from "./private-profile.js";

export function assertPrivateCreation(
  creation: DockerCreation,
  group: Group,
  runtime: string,
): void {
  const profile = selectedProfile(
    group.dockerPolicy!,
    creation.privateProfile,
    runtime,
  );
  if (!profile) return;
  if (creation.state !== profile.directory)
    throw new Error("foreign_container_state_directory");
  assertProfileAvailable(profile, group.projectRoot);
}
