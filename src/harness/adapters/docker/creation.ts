import { mkdirSync } from "node:fs";
import type { DockerResource } from "../../contracts.js";
import { GroupStore, privateJson } from "../../groups/store.js";
import type { LaunchJournal } from "../../launch/journal.js";
import { join } from "node:path";
import { object, text } from "../../validation.js";
import { command } from "../process/command.js";
import { admitClaim } from "./admission.js";
import { assertResourceOwner, configurationDigest } from "./claims.js";
import { DockerEngine } from "./engine.js";
import { assertCreationConfiguration } from "./creation-plan.js";
import { resourceAbsent } from "./observation.js";
import { assertLocalDocker } from "./profile.js";
import { prepareBridge, assertBridge } from "./bridge-artifact.js";
import { assertProfileAvailable } from "./private-profile.js";
import { selectedProfile } from "../../runtimes/private-profiles.js";

export async function prepareCreation(
  journal: LaunchJournal,
): Promise<DockerResource> {
  const intent = journal.intent();
  const creation = intent.dockerCreation;
  if (!creation) throw new Error("container_creation_missing");
  const group = new GroupStore(join(journal.records.directory, "group.json"))
    .state.group;
  const profile = selectedProfile(
    group.dockerPolicy!,
    creation.privateProfile,
    intent.runtime,
  );
  if (profile) assertProfileAvailable(profile, group.projectRoot);
  if (!profile) mkdirSync(creation.state, { recursive: true, mode: 0o700 });
  prepareBridge(creation);
  assertBridge(creation);
  const id = await new DockerEngine().create(
    creation.name,
    creation.configuration,
  );
  const current = new GroupStore(join(journal.records.directory, "group.json"))
    .state.group;
  if (current.id !== intent.groupId || current.generation !== intent.generation)
    throw new Error("launch_group_generation_mismatch");
  const resource: DockerResource = {
    ...admitClaim(
      {
        id,
        owner: intent.owner,
        role: intent.role,
        runtime: intent.runtime,
        image: current.dockerPolicy?.image,
        nonce: creation.nonce,
        state: creation.state,
        ...(creation.privateProfile
          ? { privateProfile: creation.privateProfile }
          : {}),
      },
      current,
      intent.role,
      journal.records.directory,
      intent.memoryMb,
      intent.runtime,
      intent.cwd,
    ),
    managed: true,
  };
  assertCreationConfiguration(
    object(JSON.parse(command("docker", ["inspect", id]))[0]),
    creation,
  );
  privateJson(journal.path("intent"), {
    ...intent,
    resource,
    argv: [intent.argv[0], "start", "--attach", "--interactive", id],
  });
  return resource;
}

export function findCreation(
  journal: LaunchJournal,
): DockerResource | undefined {
  const intent = journal.intent();
  const creation = intent.dockerCreation;
  if (!creation) return intent.resource;
  assertLocalDocker();
  let actual: Record<string, unknown>;
  try {
    const values: unknown = JSON.parse(
      command("docker", ["inspect", creation.name]),
    );
    if (!Array.isArray(values) || values.length !== 1)
      throw new Error("invalid_container_inspection");
    actual = object(values[0]);
  } catch (error) {
    if (resourceAbsent(error, creation.name)) return;
    throw error;
  }
  const resource: DockerResource = {
    kind: "docker",
    id: text(actual.Id, "container_id"),
    owner: intent.owner,
    nonce: creation.nonce,
    role: intent.role,
    image: text(creation.configuration.Image, "container_image"),
    configurationDigest: configurationDigest(actual),
    memoryMb: Number(object(actual.HostConfig).Memory) / 1048576,
    cpuQuota: Number(object(actual.HostConfig).CpuQuota),
    managed: true,
    ...(creation.privateProfile
      ? { privateProfile: creation.privateProfile }
      : {}),
  };
  assertResourceOwner(resource, actual);
  assertCreationConfiguration(actual, creation);
  if (!intent.resource) {
    const group = new GroupStore(join(journal.records.directory, "group.json"))
      .state.group;
    return {
      ...admitClaim(
        { ...resource, runtime: intent.runtime, state: creation.state },
        group,
        intent.role,
        journal.records.directory,
        intent.memoryMb,
        intent.runtime,
        intent.cwd,
      ),
      managed: true,
    };
  }
  if (
    intent.resource &&
    (resource.id !== intent.resource.id ||
      resource.configurationDigest !== intent.resource.configurationDigest)
  )
    throw new Error("container_creation_configuration_changed");
  return resource;
}
