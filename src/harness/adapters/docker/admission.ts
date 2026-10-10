import { lstatSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import type { DockerResource, Group } from "../../contracts.js";
import { readPrivateJson } from "../../groups/store.js";
import { integer, object, text } from "../../validation.js";
import { assertLocalDocker } from "./profile.js";
import { assertContainerMounts } from "./mounts.js";
import { assertContainerIsolation } from "./security.js";
import { configurationDigest } from "./claims.js";
import { inspectResource } from "./observation.js";
import { containerEntrypoint } from "./entrypoint.js";
import { profileName } from "../../runtimes/private-profiles.js";

export function admitResource(
  path: unknown,
  group: Group,
  role: "main" | "worker",
  directory: string,
  memoryMb: number,
  runtime: string,
): DockerResource {
  if (group.profile !== "docker" || !group.dockerPolicy)
    throw new Error("container_requires_docker_profile");
  const { projectRoot } = group;
  assertLocalDocker();
  const inputPath = text(path, "container_file");
  if (lstatSync(inputPath).isSymbolicLink())
    throw new Error("symlink_container_file_not_admitted");
  const source = realpathSync(inputPath);
  const scope = relative(projectRoot, source);
  if (scope === ".." || scope.startsWith("../"))
    throw new Error("container_file_outside_project");
  const claim = object(readPrivateJson(source));
  if (claim.privateProfile !== undefined)
    throw new Error("private_profile_requires_cli_owned_creation");
  return admitClaim(claim, group, role, directory, memoryMb, runtime);
}

export function admitClaim(
  value: unknown,
  group: Group,
  role: "main" | "worker",
  directory: string,
  memoryMb: number,
  runtime: string,
  cwd = group.projectRoot,
): DockerResource {
  if (group.profile !== "docker" || !group.dockerPolicy)
    throw new Error("container_requires_docker_profile");
  assertLocalDocker();
  const policy = group.dockerPolicy;
  const { owner, projectRoot } = group;
  const claim = object(value);
  if (claim.owner !== owner || claim.role !== role || claim.runtime !== runtime)
    throw new Error("foreign_container_resource");
  const resource: DockerResource = {
    kind: "docker",
    id: text(claim.id, "container_id"),
    owner,
    nonce: text(claim.nonce, "container_nonce"),
    role,
    image: text(claim.image, "container_image"),
    configurationDigest: "",
    memoryMb: 0,
    cpuQuota: 0,
    ...(claim.privateProfile === undefined
      ? {}
      : { privateProfile: profileName(claim.privateProfile) }),
  };
  if (
    !/^[a-f0-9]{64}$/.test(resource.id) ||
    !/^sha256:[a-f0-9]{64}$/.test(resource.image) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      resource.nonce,
    )
  )
    throw new Error("invalid_container_resource");
  const actual = inspectResource(resource, false);
  const state = object(actual.State);
  const config = object(actual.Config);
  const host = object(actual.HostConfig);
  if (
    resource.image !== policy.image ||
    JSON.stringify(config.Entrypoint) !==
      JSON.stringify(
        containerEntrypoint(
          policy,
          runtime,
          resource.nonce,
          resource.privateProfile,
        ),
      )
  )
    throw new Error("container_runtime_image_not_granted");
  if (config.WorkingDir !== join("/workspace", relative(projectRoot, cwd)))
    throw new Error("container_cwd_not_granted");
  assertContainerMounts(
    actual,
    claim.state,
    projectRoot,
    directory,
    resource.nonce,
    policy,
    resource.privateProfile,
    runtime,
  );
  if (state.Status !== "created" || state.Pid !== 0 || state.Running !== false)
    throw new Error("container_requires_fresh_creation");
  if (
    config.User !== `${process.getuid?.()}:${process.getgid?.()}` ||
    config.Tty !== true ||
    config.OpenStdin !== true ||
    config.StdinOnce !== false ||
    !Array.isArray(config.Env) ||
    JSON.stringify(
      config.Env.filter(
        (value) => typeof value === "string" && value.startsWith("HOME="),
      ),
    ) !== '["HOME=/state"]'
  )
    throw new Error("invalid_container_terminal_policy");
  assertContainerIsolation(host, policy.network);
  resource.memoryMb = integer(
    Number(host.Memory) / 1048576,
    "container_memory",
    32,
    1472,
  );
  if (host.MemorySwap !== host.Memory || memoryMb - resource.memoryMb < 64)
    throw new Error("container_proxy_memory_unreserved");
  integer(host.PidsLimit, "container_tasks", 1, 128);
  if (host.CpuPeriod !== 100000)
    throw new Error("invalid_container_cpu_period");
  resource.cpuQuota = integer(host.CpuQuota, "container_cpu", 1, 50000);
  resource.configurationDigest = configurationDigest(actual);
  return resource;
}
