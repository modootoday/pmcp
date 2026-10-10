import { homedir } from "node:os";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statfsSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { PrivateProfileGrant } from "../../contracts.js";
import { command } from "../process/command.js";

export const privateProfileLock = "profile.lock";

function overlap(left: string, right: string): boolean {
  const scope = relative(left, right);
  return scope === "" || (scope !== ".." && !scope.startsWith("../"));
}

export function profileIdentity(
  directory: string,
  projectRoot: string,
): string {
  if (
    directory === "/" ||
    directory === realpathSync(homedir()) ||
    overlap(directory, projectRoot) ||
    overlap(projectRoot, directory) ||
    realpathSync(directory) !== directory
  )
    throw new Error("private_profile_scope_not_admitted");
  const stat = lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o700
  )
    throw new Error("unsafe_private_profile_directory");
  if ([0x6969, 0xff534d42, 0xfe534d42].includes(statfsSync(directory).type))
    throw new Error("remote_private_profile_not_admitted");
  const lock = openSync(
    join(directory, privateProfileLock),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const value = fstatSync(lock);
    if (
      !value.isFile() ||
      value.nlink !== 1 ||
      value.uid !== process.getuid?.() ||
      (value.mode & 0o777) !== 0o600
    )
      throw new Error("unsafe_private_profile_lock");
    return `${stat.dev}:${stat.ino}:${value.dev}:${value.ino}`;
  } finally {
    closeSync(lock);
  }
}

export function captureProfile(
  grant: PrivateProfileGrant,
  projectRoot: string,
): PrivateProfileGrant {
  const directory = realpathSync(grant.directory);
  if (
    directory !== grant.directory ||
    overlap(directory, projectRoot) ||
    overlap(projectRoot, directory) ||
    directory === "/" ||
    directory === realpathSync(homedir())
  )
    throw new Error("private_profile_scope_not_admitted");
  const stat = lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o700
  )
    throw new Error("unsafe_private_profile_directory");
  const lock = join(directory, privateProfileLock);
  if (!existsSync(lock)) closeSync(openSync(lock, "wx", 0o600));
  const identity = profileIdentity(directory, projectRoot);
  if (grant.identity && grant.identity !== identity)
    throw new Error("private_profile_identity_changed");
  return { ...grant, identity };
}

export function assertProfileIdentity(
  grant: PrivateProfileGrant,
  projectRoot: string,
): void {
  if (
    !grant.identity ||
    profileIdentity(grant.directory, projectRoot) !== grant.identity
  )
    throw new Error("private_profile_identity_changed");
}

export function assertProfileAvailable(
  grant: PrivateProfileGrant,
  projectRoot: string,
): void {
  assertProfileIdentity(grant, projectRoot);
  try {
    command("flock", [
      "--exclusive",
      "--nonblock",
      "--conflict-exit-code",
      "73",
      join(grant.directory, privateProfileLock),
      "true",
    ]);
  } catch (error) {
    if ((error as { status?: number }).status === 73)
      throw new Error("private_profile_busy");
    throw error;
  }
}
