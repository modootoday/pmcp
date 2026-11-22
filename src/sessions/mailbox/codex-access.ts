import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { findConfig, readConfig } from "../../config.js";
import { mailboxPaths } from "../files/mailbox.js";
import { readStoreSettings } from "../settings.js";
import { projectStateDir } from "../state-dir.js";

export async function codexMailboxRoots(
  desk: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string[]> {
  const configPath = findConfig(desk);
  if (!configPath) return [];
  const config = readConfig(configPath);
  const settings = readStoreSettings(config.raw["sessions"], config.raw["git"]);
  if (!settings.mailbox?.enabled) return [];

  const paths = mailboxPaths(
    projectStateDir(config.dir, settings.stateDir, env),
  );
  const directories = [paths.messages, paths.inbox];
  for (const path of directories) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!(await lstat(path)).isDirectory())
      throw new Error(`unsafe mailbox directory: ${path}`);
  }
  if (settings.mailbox.audit) await exposeAudit(paths.audit, paths.messages);
  return directories;
}

async function exposeAudit(legacy: string, messages: string): Promise<void> {
  const target = join(messages, ".audit.jsonl");
  const audit = await open(
    legacy,
    constants.O_CREAT |
      constants.O_APPEND |
      constants.O_WRONLY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  ).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ELOOP") throw error;
    if ((await readlink(legacy)) === target && (await lstat(target)).isFile())
      return null;
    throw new Error(`unsafe mailbox audit file: ${legacy}`);
  });
  if (!audit) return;
  try {
    const original = await audit.stat();
    if (!original.isFile())
      throw new Error(`unsafe mailbox audit file: ${legacy}`);
    await link(legacy, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const linked = await lstat(target);
    const visible = await stat(legacy);
    if (
      !linked.isFile() ||
      [linked, visible].some(
        (file) => file.dev !== original.dev || file.ino !== original.ino,
      )
    )
      throw new Error(`conflicting mailbox audit file: ${legacy}`);
    const temporary = await mkdtemp(join(messages, ".audit-link-"));
    try {
      const replacement = join(temporary, "link");
      await symlink(target, replacement);
      await rename(replacement, legacy);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } finally {
    await audit.close();
  }
}
