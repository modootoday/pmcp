import { object } from "../../validation.js";

export function assertContainerIsolation(
  host: Record<string, unknown>,
  network: "none",
): void {
  if (
    host.ReadonlyRootfs !== true ||
    host.Privileged !== false ||
    host.NetworkMode !== network ||
    host.CgroupnsMode !== "private"
  )
    throw new Error("invalid_container_isolation_policy");
  if (
    JSON.stringify(host.CapDrop) !== '["ALL"]' ||
    JSON.stringify(host.SecurityOpt) !== '["no-new-privileges"]' ||
    object(host.RestartPolicy).Name !== "no"
  )
    throw new Error("invalid_container_execution_policy");
  if (
    host.CapAdd !== null ||
    host.PidMode !== "" ||
    host.UTSMode !== "" ||
    host.UsernsMode !== "" ||
    host.CgroupParent !== "" ||
    host.IpcMode !== "private" ||
    hasDevices(host.Devices) ||
    hasDevices(host.DeviceRequests) ||
    host.AutoRemove !== false ||
    host.VolumesFrom !== null ||
    host.GroupAdd !== null ||
    host.Binds !== null ||
    Object.keys(object(host.PortBindings)).length
  )
    throw new Error("ungranted_container_host_authority");
}

function hasDevices(value: unknown): boolean {
  if (value === null) return false;
  return !Array.isArray(value) || value.length !== 0;
}
