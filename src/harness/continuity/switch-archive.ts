import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ContinuityCheckpoint } from "./index.js";
import type { SwitchIntent } from "./journal.js";

export async function saveSwitchArchive(
  directory: string,
  checkpoint: ContinuityCheckpoint,
  intent: SwitchIntent,
): Promise<string> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw new Error("unsafe_continuity_archive_directory");

  const archive = join(directory, `${intent.id}.jsonl`);
  const temporary = `${archive}.tmp`;
  const output = await open(temporary, "wx", 0o600);
  try {
    try {
      const { events, worktreePath, ...metadata } = checkpoint;
      await output.writeFile(
        JSON.stringify({
          ...metadata,
          worktree: worktreePath,
          switch: intent,
        }) + "\n",
      );
      for (const event of events)
        await output.writeFile(JSON.stringify(event) + "\n");
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(temporary, archive);
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return archive;
  } finally {
    await rm(temporary, { force: true });
  }
}
