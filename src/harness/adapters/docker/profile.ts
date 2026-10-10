import { homedir } from "node:os";
import { lstatSync, realpathSync } from "node:fs";
import { relative } from "node:path";
import type { DockerPolicy } from "../../contracts.js";
import { readPrivateJson } from "../../groups/store.js";
import { text } from "../../validation.js";
import { command } from "../process/command.js";
import { dockerPolicy } from "../../runtimes/docker-policy.js";
import { captureProfile } from "./private-profile.js";

export function assertLocalDocker(): void {
  if (process.env.DOCKER_HOST)
    throw new Error("explicit_docker_host_not_admitted");
  const endpoint = JSON.parse(
    command("docker", [
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ]),
  );
  if (new URL(endpoint).protocol !== "unix:")
    throw new Error("remote_docker_context_not_admitted");
}

export function loadDockerPolicy(
  path: unknown,
  projectRoot: string,
  runtimes: string[],
): DockerPolicy {
  if (projectRoot === "/" || projectRoot === realpathSync(homedir()))
    throw new Error("docker_project_root_too_broad");
  const inputPath = text(path, "docker_policy_file");
  if (lstatSync(inputPath).isSymbolicLink())
    throw new Error("symlink_docker_policy_not_admitted");
  const source = realpathSync(inputPath);
  const scope = relative(projectRoot, source);
  if (scope === ".." || scope.startsWith("../"))
    throw new Error("docker_policy_outside_project");
  const policy = dockerPolicy(readPrivateJson(source));
  if (policy.privateProfiles) {
    for (const [name, grant] of Object.entries(policy.privateProfiles)) {
      if (!runtimes.includes(grant.runtime))
        throw new Error("private_profile_runtime_not_granted");
      policy.privateProfiles[name] = captureProfile(grant, projectRoot);
    }
  }
  if (runtimes.some((runtime) => !policy.commands[runtime]))
    throw new Error("docker_runtime_command_not_granted");
  assertLocalDocker();
  const images = JSON.parse(
    command("docker", ["image", "inspect", policy.image]),
  );
  if (
    !Array.isArray(images) ||
    images.length !== 1 ||
    images[0]?.Id !== policy.image
  )
    throw new Error("docker_image_not_available");
  return policy;
}
