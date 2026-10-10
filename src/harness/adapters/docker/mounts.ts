import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { DockerPolicy } from "../../contracts.js";
import { object, text } from "../../validation.js";
import { selectedProfile } from "../../runtimes/private-profiles.js";
import { assertProfileIdentity } from "./private-profile.js";

export function assertContainerMounts(
  actual: Record<string, unknown>,
  statePath: unknown,
  projectRoot: string,
  directory: string,
  nonce: string,
  policy: DockerPolicy,
  privateProfile?: string,
  runtime?: string,
): void {
  const state = text(statePath, "container_state_directory");
  const profile = selectedProfile(policy, privateProfile, runtime ?? "");
  if (profile) assertProfileIdentity(profile, projectRoot);
  const expected =
    profile?.directory ?? join(directory, "containers", nonce, "profile");
  if (state !== expected || realpathSync(state) !== expected)
    throw new Error("foreign_container_state_directory");
  const stat = lstatSync(state);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("unsafe_container_state_directory");
  if (!Array.isArray(actual.Mounts) || actual.Mounts.length !== 2)
    throw new Error("ungranted_container_mount");
  if (
    new Set(actual.Mounts.map((value) => object(value).Destination)).size !== 2
  )
    throw new Error("ungranted_container_mount");
  const expectedMounts = [
    {
      Source: projectRoot,
      Destination: "/workspace",
      RW: policy.workspaceAccess === "read-write",
    },
    { Source: state, Destination: "/state", RW: true },
  ];
  for (const value of actual.Mounts) {
    const mount = object(value);
    if (
      mount.Type !== "bind" ||
      mount.Propagation !== "rprivate" ||
      !expectedMounts.some(
        (expected) =>
          mount.Source === expected.Source &&
          mount.Destination === expected.Destination &&
          mount.RW === expected.RW,
      )
    )
      throw new Error("ungranted_container_mount");
  }
  const host = object(actual.HostConfig);
  if (
    !Array.isArray(host.Mounts) ||
    host.Mounts.length !== 2 ||
    host.Mounts.some(
      (value) => object(object(value).BindOptions).NonRecursive !== true,
    )
  )
    throw new Error("recursive_container_mount_not_admitted");
}
