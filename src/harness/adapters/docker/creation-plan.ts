import { join, relative } from "node:path";
import type { Group } from "../../contracts.js";
import { command } from "../process/command.js";
import { object } from "../../validation.js";
import { assertLocalDocker } from "./profile.js";
import type { EgressPolicy } from "../../runtimes/egress-policy.js";
import { containerEntrypoint } from "./entrypoint.js";
import { bridgeDigest } from "./bridge-artifact.js";
import { selectedProfile } from "../../runtimes/private-profiles.js";
import { assertProfileAvailable } from "./private-profile.js";
import { containerLabels, containerName } from "./identity.js";

export interface DockerCreation {
  name: string;
  nonce: string;
  state: string;
  configuration: Record<string, unknown>;
  egress?: EgressPolicy;
  bridgeSha256?: string;
  privateProfile?: string;
}

export interface DockerPreparation {
  args: string[];
  memoryMb: number;
  cpuQuota: number;
  privateProfile?: string;
}

export function creationPlan(
  group: Group,
  directory: string,
  id: string,
  nonce: string,
  role: "main" | "worker",
  runtime: string,
  cwd: string,
  preparation: DockerPreparation,
): DockerCreation {
  if (group.profile !== "docker" || !group.dockerPolicy)
    throw new Error("container_requires_docker_profile");
  assertLocalDocker();
  const policy = group.dockerPolicy;
  const images: unknown = JSON.parse(
    command("docker", ["image", "inspect", policy.image]),
  );
  if (
    !Array.isArray(images) ||
    images.length !== 1 ||
    object(images[0]).Id !== policy.image
  )
    throw new Error("docker_image_not_available");
  const imageConfig = object(object(images[0]).Config);
  const environment = imageConfig.Env;
  if (
    !Array.isArray(environment) ||
    environment.some((entry) => typeof entry !== "string")
  )
    throw new Error("invalid_container_image_environment");
  const profile = selectedProfile(policy, preparation.privateProfile, runtime);
  if (profile) assertProfileAvailable(profile, group.projectRoot);
  const state =
    profile?.directory ?? join(directory, "containers", nonce, "profile");
  return {
    name: containerName(group.owner, id),
    nonce,
    state,
    ...(preparation.privateProfile
      ? { privateProfile: preparation.privateProfile }
      : {}),
    ...(policy.egress ? { egress: policy.egress } : {}),
    ...(policy.egress?.bridgeExecutable
      ? { bridgeSha256: bridgeDigest() }
      : {}),
    configuration: {
      Image: policy.image,
      Entrypoint: containerEntrypoint(
        policy,
        runtime,
        nonce,
        preparation.privateProfile,
      ),
      Cmd: preparation.args.length ? preparation.args : null,
      WorkingDir: join("/workspace", relative(group.projectRoot, cwd)),
      User: `${process.getuid?.()}:${process.getgid?.()}`,
      Env: [
        ...environment.filter(
          (entry) => !/^(HOME|TERM|PMCP_HTTPS_PROXY_SOCKET)=/.test(entry),
        ),
        "HOME=/state",
        "TERM=xterm-256color",
        ...(policy.egress
          ? [`PMCP_HTTPS_PROXY_SOCKET=/state/e${nonce.slice(0, 8)}`]
          : []),
      ],
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Labels: {
        ...(imageConfig.Labels ?? {}),
        [containerLabels.owner]: group.owner,
        [containerLabels.nonce]: nonce,
        [containerLabels.role]: role,
      },
      HostConfig: {
        NetworkMode: policy.network,
        CgroupnsMode: "private",
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Memory: preparation.memoryMb * 1048576,
        MemorySwap: preparation.memoryMb * 1048576,
        PidsLimit: 64,
        CpuPeriod: 100000,
        CpuQuota: preparation.cpuQuota,
        RestartPolicy: { Name: "no" },
        LogConfig: { Type: "none" },
        Tmpfs: { "/tmp": "rw,nosuid,noexec,size=16m" },
        Mounts: [
          {
            Type: "bind",
            Source: group.projectRoot,
            Target: "/workspace",
            ...(policy.workspaceAccess === "read-only"
              ? { ReadOnly: true }
              : {}),
            BindOptions: { NonRecursive: true },
          },
          {
            Type: "bind",
            Source: state,
            Target: "/state",
            BindOptions: { NonRecursive: true },
          },
        ],
      },
    },
  };
}

export function assertCreationConfiguration(
  actual: Record<string, unknown>,
  creation: DockerCreation,
): void {
  if (actual.Name !== `/${creation.name}`)
    throw new Error("foreign_container_creation");
  const expected = creation.configuration;
  const config = object(actual.Config);
  const host = object(actual.HostConfig);
  for (const [key, value] of Object.entries(expected)) {
    if (key === "HostConfig" || key === "Image") continue;
    if (!matchesFields(config[key], value))
      throw new Error(`container_creation_configuration_changed_${key}`);
  }
  for (const [key, value] of Object.entries(object(expected.HostConfig))) {
    if (!matchesFields(host[key], value))
      throw new Error(`container_creation_configuration_changed_${key}`);
  }
}

function matchesFields(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => matchesFields(actual[index], value))
    );
  if (expected === null || typeof expected !== "object")
    return actual === expected;
  if (actual === null || typeof actual !== "object" || Array.isArray(actual))
    return false;
  const value = actual as Record<string, unknown>;
  return Object.entries(expected).every(([key, field]) =>
    matchesFields(value[key], field),
  );
}
