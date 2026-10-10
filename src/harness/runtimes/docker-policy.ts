import { isAbsolute, posix } from "node:path";
import type { DockerPolicy } from "../contracts.js";
import { object, strings, text } from "../validation.js";
import { runtimeExecutables } from "./registry.js";
import { egressPolicy } from "./egress-policy.js";
import { privateProfiles } from "./private-profiles.js";

export function dockerPolicy(value: unknown): DockerPolicy {
  const policy = object(value);
  if (policy.schemaVersion !== 1)
    throw new Error("invalid_docker_policy_version");
  if (!/^sha256:[a-f0-9]{64}$/.test(text(policy.image, "docker_image")))
    throw new Error("docker_image_requires_digest");
  if (policy.network !== "none")
    throw new Error("docker_network_not_qualified");
  if (
    policy.workspaceAccess !== "read-only" &&
    policy.workspaceAccess !== "read-write"
  )
    throw new Error("invalid_docker_workspace_access");
  const commands = object(policy.commands);
  const entries = Object.entries(commands);
  if (!entries.length || entries.length > 5)
    throw new Error("invalid_docker_runtime_commands");
  const parsed: Record<string, string[]> = {};
  for (const [runtime, value] of entries) {
    if (!Object.hasOwn(runtimeExecutables, runtime))
      throw new Error("unsupported_docker_runtime");
    const command = strings(value, "docker_runtime_command");
    const executable = command[0]!;
    if (
      !isAbsolute(executable) ||
      posix.normalize(executable) !== executable ||
      command.some((argument) => /[\r\n\x1b]/.test(argument))
    )
      throw new Error("invalid_docker_runtime_command");
    parsed[runtime] = command;
  }
  return {
    schemaVersion: 1,
    image: text(policy.image, "docker_image"),
    network: "none",
    workspaceAccess: policy.workspaceAccess,
    commands: parsed,
    ...(policy.egress === undefined
      ? {}
      : { egress: egressPolicy(policy.egress) }),
    ...(policy.privateProfiles === undefined
      ? {}
      : { privateProfiles: privateProfiles(policy.privateProfiles) }),
  };
}
