import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { historyDesk } from "./history-desk.js";
import {
  streamContinuityHistory,
  type HistoryRuntime,
} from "./import-history.js";

export async function archiveContinuityHistory(options: {
  runtime: HistoryRuntime;
  sessionId: string;
  source: string;
  archive: string;
  worktree: string;
}): Promise<{ messages: number; worktree: string }> {
  const { worktree, previousDirectory } = await historyDesk(options.worktree);
  const temporary = `${options.archive}.${randomUUID()}.tmp`;
  const output = await open(temporary, "wx", 0o600);
  let messages = 0;
  try {
    await output.writeFile(
      JSON.stringify({
        version: 1,
        runtime: options.runtime,
        sessionId: options.sessionId.toLowerCase(),
        worktree,
        previousDirectory,
      }) + "\n",
    );
    for await (const { id, event } of streamContinuityHistory(options)) {
      if (options.sessionId.toLowerCase() !== id)
        throw new Error("history_session_mismatch");
      await output.writeFile(JSON.stringify(event) + "\n");
      messages++;
    }
    if (!messages) throw new Error("empty_history");
    await output.sync();
    await link(temporary, options.archive);
  } finally {
    await output.close();
    await unlink(temporary);
  }
  return { messages, worktree };
}
