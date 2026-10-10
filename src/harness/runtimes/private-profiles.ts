import { isAbsolute, posix } from "node:path";
import type { DockerPolicy, PrivateProfileGrant } from "../contracts.js";
import { object, text } from "../validation.js";

export function profileName(value: unknown): string {
  const name = text(value, "private_profile");
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name))
    throw new Error("invalid_private_profile_name");
  return name;
}

export function privateProfiles(
  value: unknown,
): Record<string, PrivateProfileGrant> {
  const entries = Object.entries(object(value));
  if (!entries.length || entries.length > 16)
    throw new Error("invalid_private_profile_grants");
  const result: Record<string, PrivateProfileGrant> = {};
  for (const [name, entry] of entries) {
    profileName(name);
    const grant = object(entry);
    const runtime = text(grant.runtime, "private_profile_runtime");
    const directory = absolute(grant.directory, "private_profile_directory");
    const lockExecutable = absolute(
      grant.lockExecutable,
      "private_profile_lock_executable",
    );
    const identity =
      grant.identity === undefined
        ? undefined
        : text(grant.identity, "private_profile_identity");
    if (identity !== undefined && !/^\d+:\d+:\d+:\d+$/.test(identity))
      throw new Error("invalid_private_profile_identity");
    result[name] = {
      runtime,
      directory,
      lockExecutable,
      ...(identity ? { identity } : {}),
    };
  }
  if (
    new Set(Object.values(result).map((grant) => grant.directory)).size !==
    entries.length
  )
    throw new Error("duplicate_private_profile_directory");
  return result;
}

function absolute(value: unknown, field: string): string {
  const path = text(value, field);
  if (
    !isAbsolute(path) ||
    posix.normalize(path) !== path ||
    /[\r\n\x1b]/.test(path)
  )
    throw new Error("invalid_private_profile_path");
  return path;
}

export function selectedProfile(
  policy: DockerPolicy,
  name: unknown,
  runtime: string,
): PrivateProfileGrant | undefined {
  if (name === undefined) return;
  const grant = policy.privateProfiles?.[profileName(name)];
  if (!grant || grant.runtime !== runtime || !grant.identity)
    throw new Error("private_profile_not_granted");
  return grant;
}
