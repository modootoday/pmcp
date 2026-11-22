import type { FileHandle } from "node:fs/promises";
import { createInterface } from "node:readline";

export async function* streamClaudeHistory(file: FileHandle, size: number) {
  let id: string | undefined;
  if (!size) return;
  const input = file.createReadStream({
    start: 0,
    end: size - 1,
    autoClose: false,
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.isSidechain || row.isMeta || row.isCompactSummary) continue;
      if (row.type !== "user" && row.type !== "assistant") continue;
      if (typeof row.sessionId !== "string" || (id && id !== row.sessionId)) {
        throw new Error("invalid_claude_history_session");
      }
      id = row.sessionId;
      const content = row.message?.content;
      const text = Array.isArray(content)
        ? content.filter(
            (block) => block?.type === "text" && typeof block.text === "string",
          )
        : content;
      yield {
        id,
        role: row.type as "user" | "assistant",
        content: text,
        timestamp: row.timestamp,
      };
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
