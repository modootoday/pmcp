import type { DockerPolicy } from "../../contracts.js";
import { selectedProfile } from "../../runtimes/private-profiles.js";
import { privateProfileLock } from "./private-profile.js";

export function bridgeName(nonce: string): string {
  return `.pmcp-egress-${nonce.slice(0, 8)}.mjs`;
}

export function containerEntrypoint(
  policy: DockerPolicy,
  runtime: string,
  nonce: string,
  privateProfile?: string,
): string[] {
  const native = policy.commands[runtime];
  if (!native) throw new Error("docker_runtime_command_not_granted");
  const command = policy.egress?.bridgeExecutable
    ? [
        policy.egress.bridgeExecutable,
        `/state/${bridgeName(nonce)}`,
        "--",
        ...native,
      ]
    : native;
  const profile = selectedProfile(policy, privateProfile, runtime);
  if (!profile) return command;
  return [
    profile.lockExecutable,
    "--exclusive",
    "--nonblock",
    "--close",
    "--conflict-exit-code",
    "73",
    `/state/${privateProfileLock}`,
    ...command,
  ];
}
