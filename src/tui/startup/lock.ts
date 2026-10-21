import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { lockFile } from "../../locks/file-lock.js";
import { ensureStartupDirectory, startupFile } from "./state.js";
import { startupSettings, type StartupRequest } from "./config.js";
import { prepareWorkspace } from "./workspace.js";
import type { Receipt } from "../../harness/contracts.js";

// One startup per project at a time; a second waits up to ten seconds, then says busy.
export async function serializedStartup(
  request: StartupRequest,
): Promise<Receipt> {
  const settings = startupSettings(request);
  const file = startupFile(settings.projectRoot);
  ensureStartupDirectory(file);
  const lock = `${file}.lock`;
  const descriptor = openSync(
    lock,
    constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error("unsafe_startup_lock");
  } finally {
    closeSync(descriptor);
  }
  const held = lockFile(lock, 10_000);
  if (!held) throw new Error("startup_busy");
  try {
    return await prepareWorkspace(request);
  } finally {
    held.release();
  }
}
