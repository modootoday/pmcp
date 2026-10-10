import { createHash } from "node:crypto";
import type { DockerResource } from "../../contracts.js";
import { integer, object, text } from "../../validation.js";
import { profileName } from "../../runtimes/private-profiles.js";
import { containerLabels } from "./identity.js";

export function resourceClaim(value: unknown, owner: string): DockerResource {
  const record = object(value);
  if (record.kind !== "docker" || record.owner !== owner)
    throw new Error("foreign_container_resource");
  if (!/^[a-f0-9]{64}$/.test(text(record.id, "container_id")))
    throw new Error("invalid_container_id");
  if (!/^sha256:[a-f0-9]{64}$/.test(text(record.image, "container_image")))
    throw new Error("invalid_container_image");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      text(record.nonce, "container_nonce"),
    )
  )
    throw new Error("invalid_container_nonce");
  if (record.role !== "main" && record.role !== "worker")
    throw new Error("invalid_container_role");
  if (
    !/^[a-f0-9]{64}$/.test(
      text(record.configurationDigest, "container_configuration"),
    )
  )
    throw new Error("invalid_container_configuration");
  integer(record.memoryMb, "container_memory", 32, 1472);
  integer(record.cpuQuota, "container_cpu", 1, 50000);
  if (record.managed !== undefined && record.managed !== true)
    throw new Error("invalid_container_custody");
  if (record.privateProfile !== undefined) {
    profileName(record.privateProfile);
    if (record.managed !== true)
      throw new Error("private_profile_requires_cli_owned_creation");
  }
  return record as unknown as DockerResource;
}

export function assertResourceOwner(
  resource: DockerResource,
  actual: Record<string, unknown>,
): void {
  const config = object(actual.Config);
  const labels = object(config.Labels);
  if (
    actual.Id !== resource.id ||
    actual.Image !== resource.image ||
    labels[containerLabels.owner] !== resource.owner ||
    labels[containerLabels.nonce] !== resource.nonce ||
    labels[containerLabels.role] !== resource.role
  )
    throw new Error("foreign_container_identity");
}

export function configurationDigest(actual: Record<string, unknown>): string {
  const host = object(actual.HostConfig);
  if (host.OomKillDisable !== false && host.OomKillDisable !== null)
    throw new Error("container_oom_protection_disabled");
  if (!Array.isArray(actual.Mounts))
    throw new Error("invalid_container_mounts");
  const mounts = actual.Mounts.map(object).sort((left, right) =>
    text(left.Destination, "mount_destination").localeCompare(
      text(right.Destination, "mount_destination"),
    ),
  );
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalValue({
          config: actual.Config,
          host: { ...host, OomKillDisable: false },
          mounts,
        }),
      ),
    )
    .digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}
